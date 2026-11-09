import assert from "node:assert/strict";
import { afterEach, beforeEach, describe, it, mock } from "node:test";
import { authFeatures } from "../lib/auth-features";
import React from "react";
import { JSDOM } from "jsdom";
import { MockPantryApi } from "../mocks/pantry-api";

const dom = new JSDOM("<!doctype html><html><body></body></html>", { url: "http://localhost/login" });
for (const key of ["window", "document", "navigator", "location", "history", "HTMLElement", "HTMLInputElement", "HTMLButtonElement", "HTMLSelectElement", "HTMLTextAreaElement", "Element", "Node", "Event", "MouseEvent", "CustomEvent", "KeyboardEvent", "NodeFilter", "MutationObserver", "getComputedStyle", "localStorage"] as const) {
  Object.defineProperty(globalThis, key, { configurable: true, value: key === "window" ? dom.window : dom.window[key] });
}
Object.defineProperty(globalThis, "React", { configurable: true, value: React });
Object.defineProperty(globalThis, "IS_REACT_ACT_ENVIRONMENT", { configurable: true, writable: true, value: true });
dom.window.HTMLElement.prototype.scrollIntoView = () => {};
// Wouter's external-store shim chooses its browser implementation at import time.
const { QueryClient, QueryClientProvider } = await import("@tanstack/react-query");
const { Router } = await import("wouter");
const { memoryLocation } = await import("wouter/memory-location");
const { setCsrfToken } = await import("@workspace/api-client-react");
const { act, cleanup, fireEvent, render, screen, waitFor, within } = await import("@testing-library/react");
const { AppRoutes } = await import("../App");
const { RouteLoadingBoundary } = await import("../components/route-loading-boundary");
const originalFetch = globalThis.fetch;
const clients = new Set<InstanceType<typeof QueryClient>>();
afterEach(() => {
  cleanup();
  for (const client of clients) client.clear();
  clients.clear();
  setCsrfToken(null);
  globalThis.fetch = originalFetch;
  localStorage.clear();
  mock.restoreAll();
});

class AuthApi {
  authenticated = false;
  csrf = "anonymous-token";
  requests: { path: string; method: string; csrf: string | null; body: Record<string, unknown> }[] = [];
  pantry = new MockPantryApi();
  codeFailure = 0;
  codeFailureMessage = "Too many requests. Please wait before trying again.";
  verifyFailure = "";
  codeGate: Promise<void> | null = null;
  loseVerifyResponse = false;
  account = { id: 1, email: "user@example.com", name: "User" as string | null };
  logoutFailure = false;
  logoutGate: Promise<void> | null = null;
  readonly fetch = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const path = new URL(String(input), "http://localhost").pathname;
    const method = (init?.method || "GET").toUpperCase();
    const csrf = new Headers(init?.headers).get("X-CSRF-TOKEN");
    const body = init?.body ? JSON.parse(String(init.body)) as Record<string, unknown> : {};
    this.requests.push({ path, method, csrf, body });
    const json = (value: unknown, status = 200) => new Response(JSON.stringify(value), { status, headers: { "Content-Type": "application/json" } });
    if (path === "/api/auth/session" && method === "GET")
      return json({ authenticated: this.authenticated, account: this.authenticated ? this.account : null, csrfToken: this.csrf });
    if (path.startsWith("/api/auth/") && csrf !== this.csrf) return json({ error: "CSRF missing" }, 403);
    if (path === "/api/auth/code") {
      if (this.codeGate) await this.codeGate;
      if (this.codeFailure) return json({ error: this.codeFailureMessage }, this.codeFailure);
      return json({ challengeId: "challenge-1", expiresAt: new Date(Date.now() + 300_000).toISOString(), resendAt: new Date(Date.now() + 30_000).toISOString() });
    }
    if (path === "/api/auth/verify") {
      if (this.verifyFailure) return json({ error: this.verifyFailure }, 400);
      if (body.code !== "654321") return json({ error: "Invalid code" }, 400);
      this.authenticated = true; this.csrf = "signed-in-token";
      if (this.loseVerifyResponse) throw new TypeError("Verification response lost after commit");
      return json({ authenticated: true, account: this.account, csrfToken: this.csrf });
    }
    if (path === "/api/auth/logout") {
      if (this.logoutGate) await this.logoutGate;
      if (this.logoutFailure) return json({ error: "Logout unavailable" }, 500);
      this.authenticated = false; this.csrf = "new-anonymous-token";
      return json({ authenticated: false, account: null, csrfToken: this.csrf });
    }
    if (!this.authenticated) return json({ error: "Sign in" }, 401);
    return this.pantry.fetch(input, init);
  };
}

async function mount(path: string, api: AuthApi, preview = false) {
  globalThis.fetch = api.fetch;
  const location = memoryLocation({ path });
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: Infinity }, mutations: { retry: false, gcTime: Infinity } } });
  clients.add(client);
  let view!: ReturnType<typeof render>;
  // Settle the initial async session check and route effects before entering input.
  await act(async () => {
    view = render(<QueryClientProvider client={client}><Router hook={location.hook}><AppRoutes preview={preview} /></Router></QueryClientProvider>);
  });
  return { ...view, client, location };
}

describe("route loading", { concurrency: false }, () => {
  it("shows a loading status until a deferred page is ready", async () => {
    let complete!: (page: { default: () => React.JSX.Element }) => void;
    const DeferredPage = React.lazy(() => new Promise<{ default: () => React.JSX.Element }>(resolve => { complete = resolve; }));
    const location = memoryLocation({ path: "/inventory" });
    render(<Router hook={location.hook}><RouteLoadingBoundary><DeferredPage /></RouteLoadingBoundary></Router>);
    assert.equal(screen.getByRole("status").textContent, "Loading page…");
    await act(async () => { complete({ default: () => <h1>Inventory ready</h1> }); });
    await screen.findByRole("heading", { name: "Inventory ready" });
    assert.equal(screen.queryByRole("status"), null);
  });

  it("offers reload after a failed page load and allows navigation to another page", async () => {
    const originalError = console.error;
    console.error = () => {}; // React reports the intentionally rejected import to the console.
    try {
      const FailedPage = React.lazy(() => Promise.reject(new Error("Chunk unavailable")));
      const location = memoryLocation({ path: "/inventory" });
      const view = render(<Router hook={location.hook}><RouteLoadingBoundary><FailedPage /></RouteLoadingBoundary></Router>);
      await screen.findByRole("alert");
      assert.ok(screen.getByRole("button", { name: "Reload page" }));
      view.rerender(<Router hook={location.hook}><RouteLoadingBoundary><h1>Shopping lists ready</h1></RouteLoadingBoundary></Router>);
      act(() => location.navigate("/shopping-lists"));
      await screen.findByRole("heading", { name: "Shopping lists ready" });
      assert.equal(screen.queryByRole("alert"), null);
    } finally {
      console.error = originalError;
    }
  });
});

describe("email-only launch", { concurrency: false }, () => {
  for (const scenario of [
    { path: "/login", error: "Unable to request a code. Please try again shortly." },
    { path: "/signup", error: "Email could not be sent. Please try again shortly." },
  ]) {
    it(`keeps ${scenario.path} on email entry after a 503 and permits recovery`, async () => {
      const api = new AuthApi();
      api.codeFailure = 503;
      api.codeFailureMessage = scenario.error;
      await mount(scenario.path, api);
      if (scenario.path === "/signup") fireEvent.change(await screen.findByLabelText(/Your name/), { target: { value: "New Person" } });
      fireEvent.change(await screen.findByLabelText("Email address"), { target: { value: "user@example.com" } });
      fireEvent.click(screen.getByRole("button", { name: "Get verification code" }));
      const error = await screen.findByText(scenario.error);
      assert.equal(error.getAttribute("aria-live"), "polite");
      assert.equal(screen.queryByLabelText("Verification code"), null);
      assert.equal((screen.getByLabelText("Email address") as HTMLInputElement).value, "user@example.com");
      assert.equal(api.authenticated, false);
      assert.equal(api.requests.filter(request => request.path === "/api/auth/verify").length, 0);
      api.codeFailure = 0;
      fireEvent.click(screen.getByRole("button", { name: "Get verification code" }));
      await screen.findByLabelText("Verification code");
      assert.equal(screen.queryByText(scenario.error), null);
    });
  }

  it("shows neutral guidance for accepted login and enables retry only after cooldown", async () => {
    const api = new AuthApi();
    await mount("/login", api);
    fireEvent.change(await screen.findByLabelText("Email address"), { target: { value: "user@example.com" } });
    fireEvent.click(screen.getByRole("button", { name: "Get verification code" }));
    await screen.findByLabelText("Verification code");
    await screen.findByText("If an account exists for this email, we'll send a verification code.");
    assert.ok(screen.getByText(/Delivery may be delayed or unavailable.*resend countdown/));
    assert.equal(screen.queryByText("Code sent. Check your email inbox."), null);
    const resend = screen.getByRole("button", { name: /Resend in/ }) as HTMLButtonElement;
    assert.equal(resend.disabled, true);
    fireEvent.click(resend);
    assert.equal(api.requests.filter(request => request.path === "/api/auth/code").length, 1);
    const later = Date.now() + 31_000;
    mock.method(Date, "now", () => later);
    await waitFor(() => assert.equal(resend.disabled, false), { timeout: 2500 });
    fireEvent.click(screen.getByRole("button", { name: "Resend code" }));
    await waitFor(() => assert.equal(api.requests.filter(request => request.path === "/api/auth/code").length, 2));
    await waitFor(() => assert.equal((screen.getByRole("button", { name: /Resend in/ }) as HTMLButtonElement).disabled, true));
    assert.equal(api.authenticated, false);
  });

  it("uses conditional login copy and offers signup after a generic verification failure", async () => {
    const api = new AuthApi();
    api.verifyFailure = "We couldn't verify this code. Check your email and code, or request another. If you haven't registered, create an account first.";
    await mount("/login", api);
    fireEvent.change(await screen.findByLabelText("Email address"), { target: { value: "unknown@example.com" } });
    fireEvent.click(screen.getByRole("button", { name: "Get verification code" }));
    await screen.findByLabelText("Verification code");
    await screen.findByText("If an account exists for this email, we'll send a verification code.");
    assert.equal(screen.queryByText("Code sent. Check your email inbox."), null);
    assert.match(document.body.textContent ?? "", /Check your spam folder or email address/);
    fireEvent.change(screen.getByLabelText("Verification code"), { target: { value: "654321" } });
    fireEvent.click(screen.getByRole("button", { name: "Verify & continue" }));
    await screen.findByText(api.verifyFailure);
    assert.equal(api.authenticated, false);
    fireEvent.click(screen.getByRole("link", { name: "Create an account" }));
    const name = await screen.findByLabelText(/Your name/);
    fireEvent.change(name, { target: { value: "New Person" } });
    fireEvent.change(screen.getByLabelText("Email address"), { target: { value: "unknown@example.com" } });
    fireEvent.click(screen.getByRole("button", { name: "Get verification code" }));
    await screen.findByText("Code sent. Check your email inbox.");
    assert.equal(api.requests.filter(request => request.path === "/api/auth/code").at(-1)?.body.intent, "signup");
  });

  for (const preview of [false, true]) {
    for (const path of ["/login", "/signup"]) {
      it(`offers only email on ${path} in ${preview ? "demo" : "normal"} mode`, async () => {
        const api = new AuthApi();
        await mount(path, api, preview);
        const email = await screen.findByLabelText("Email address");
        assert.equal(email.getAttribute("type"), "email");
        assert.equal(screen.queryByRole("button", { name: "Mobile number" }), null);
        assert.equal(screen.queryByRole("group", { name: "Choose mobile number or email" }), null);
        assert.equal(screen.queryByRole("combobox", { name: "Country code" }), null);
        assert.doesNotMatch(document.body.textContent ?? "", /SMS|email or mobile/);
        if (path === "/signup") fireEvent.change(screen.getByLabelText(/Your name/), { target: { value: "New User" } });
        fireEvent.change(email, { target: { value: "user@example.com" } });
        // Keyboard/form submission uses the same email-only path.
        fireEvent.submit(email.closest("form")!);
        await screen.findByLabelText("Verification code");
        if (!preview) {
          const request = api.requests.find(request => request.path === "/api/auth/code")!;
          assert.equal(request.body.intent, path === "/signup" ? "signup" : "login");
          if (path === "/signup") assert.equal(request.body.name, "New User");
        }
        fireEvent.change(screen.getByLabelText("Verification code"), { target: { value: preview ? "123456" : "654321" } });
        fireEvent.click(screen.getByRole("button", { name: "Verify & continue" }));
        // The first sign-in loads the dashboard chunk lazily.
        await screen.findByRole("heading", { name: "Dashboard" }, { timeout: 10_000 });
        assert.equal(api.authenticated, !preview);
        if (preview) assert.equal(api.requests.filter(request => request.path.startsWith("/api/auth/")).length, 0);
      });
    }
  }

  it("advertises email without SMS on the landing page", async () => {
    await mount("/", new AuthApi());
    await screen.findByText("Sign in with a one-time code by email.");
    assert.doesNotMatch(document.body.textContent ?? "", /email or mobile|SMS/);
  });

  it("does not request a mobile code when the email input is modified in developer tools", async () => {
    const api = new AuthApi();
    await mount("/login", api);
    const input = await screen.findByLabelText("Email address") as HTMLInputElement;
    input.type = "tel";
    fireEvent.change(input, { target: { value: "9876543210" } });
    fireEvent.submit(input.closest("form")!);
    await screen.findByText("Enter a valid email address, such as you@example.com.");
    assert.equal(screen.queryByLabelText("Verification code"), null);
    assert.equal(api.requests.filter(request => request.path === "/api/auth/code").length, 0);
  });

  for (const action of ["request", "resend", "verify"]) {
    it(`blocks a stale mobile ${action} handler when the flag is disabled`, async () => {
      let enabled = true;
      mock.method(authFeatures, "mobilePreviewEnabled", () => enabled);
      const api = new AuthApi();
      await mount("/login", api);
      fireEvent.click(screen.getByRole("button", { name: "Mobile number" }));
      fireEvent.change(screen.getByLabelText("Mobile number"), { target: { value: "9876543210" } });
      if (action !== "request") {
        fireEvent.click(screen.getByRole("button", { name: "Get verification code" }));
        await screen.findByLabelText("Verification code");
        if (action === "verify") fireEvent.change(screen.getByLabelText("Verification code"), { target: { value: "123456" } });
      }
      enabled = false;
      if (action === "resend") {
        const resend = screen.getByRole("button", { name: /Resend/ }) as HTMLButtonElement;
        // Simulate removing the disabled attribute in developer tools.
        resend.disabled = false;
        fireEvent.click(resend);
      } else {
        const input = screen.getByLabelText(action === "request" ? "Mobile number" : "Verification code");
        fireEvent.submit(input.closest("form")!);
      }
      // React may suppress a click on a disabled resend button even after DOM
      // tampering. The next one-second OTP timer tick also resets stale state.
      await screen.findByLabelText("Email address", {}, { timeout: 3_000 });
      assert.ok(screen.getByText("Mobile sign-in is currently unavailable. Use email."));
      assert.equal(api.authenticated, false);
      assert.equal(api.requests.filter(request => ["/api/auth/code", "/api/auth/verify"].includes(request.path)).length, 0);
    });
  }
});

describe("mobile country selector", { concurrency: false }, () => {
  beforeEach(() => { mock.method(authFeatures, "mobilePreviewEnabled", () => true); });
  for (const path of ["/login", "/signup"]) {
    it(`defaults to India and previews a selected international number on ${path}`, async () => {
      const api = new AuthApi();
      await mount(path, api);
      await screen.findByRole("button", { name: "Mobile number" });
      if (path === "/signup") fireEvent.change(screen.getByLabelText(/Your name/), { target: { value: "Riya" } });
      fireEvent.click(screen.getByRole("button", { name: "Mobile number" }));
      const selector = screen.getByRole("combobox", { name: "Country code" }) as HTMLSelectElement;
      assert.equal(selector.value, "IN");
      assert.ok(within(selector).getByRole("option", { name: "India (+91)" }));
      assert.ok(within(selector).getByRole("option", { name: "Canada (+1)" }));
      assert.ok(within(selector).getByRole("option", { name: "United States (+1)" }));
      fireEvent.click(screen.getByRole("button", { name: "Get verification code" }));
      await screen.findByText("Enter your mobile number.");
      fireEvent.change(screen.getByLabelText("Mobile number"), { target: { value: "1234567" } });
      fireEvent.click(screen.getByRole("button", { name: "Get verification code" }));
      await screen.findByText("Enter a 10-digit Indian mobile number.");
      fireEvent.change(selector, { target: { value: "CA" } });
      fireEvent.click(screen.getByRole("button", { name: "Get verification code" }));
      await screen.findByLabelText("Verification code");
      assert.ok(screen.getByText("+1 1234567"));
      assert.ok(screen.getByText(/Mobile preview only/));
      fireEvent.click(screen.getByRole("button", { name: "Change number" }));
      assert.equal((screen.getByRole("combobox", { name: "Country code" }) as HTMLSelectElement).value, "CA");
      fireEvent.click(screen.getByRole("button", { name: "Get verification code" }));
      fireEvent.change(await screen.findByLabelText("Verification code"), { target: { value: "123456" } });
      fireEvent.click(screen.getByRole("button", { name: "Verify & continue" }));
      await screen.findByText(/You are not signed in/);
      assert.equal(api.authenticated, false);
      assert.equal(api.requests.filter(request => ["/api/auth/code", "/api/auth/verify"].includes(request.path)).length, 0);
    });
  }

  it("keeps distinct shared-code selections through login/signup navigation and email switching", async () => {
    const api = new AuthApi();
    await mount("/login", api);
    fireEvent.click(await screen.findByRole("button", { name: "Mobile number" }));
    fireEvent.change(screen.getByRole("combobox", { name: "Country code" }), { target: { value: "CA" } });
    fireEvent.click(screen.getByRole("link", { name: "Create account" }));
    await screen.findByRole("heading", { name: "A little more together." });
    assert.equal((screen.getByRole("combobox", { name: "Country code" }) as HTMLSelectElement).value, "CA");
    fireEvent.change(screen.getByRole("combobox", { name: "Country code" }), { target: { value: "US" } });
    fireEvent.click(screen.getByRole("button", { name: "Email address" }));
    assert.equal(screen.queryByRole("combobox", { name: "Country code" }), null);
    fireEvent.click(screen.getByRole("button", { name: "Mobile number" }));
    assert.equal((screen.getByRole("combobox", { name: "Country code" }) as HTMLSelectElement).value, "US");
    fireEvent.click(screen.getByRole("link", { name: "Sign in" }));
    await screen.findByRole("heading", { name: "Welcome home." });
    assert.equal((screen.getByRole("combobox", { name: "Country code" }) as HTMLSelectElement).value, "US");
  });

  it("reports non-India format errors without truncating an overlong pasted number", async () => {
    await mount("/login", new AuthApi());
    fireEvent.click(await screen.findByRole("button", { name: "Mobile number" }));
    fireEvent.change(screen.getByRole("combobox", { name: "Country code" }), { target: { value: "GB" } });
    for (const [number, message] of [
      ["+447123456789", /digits only/],
      ["07123 456789", /digits only/],
      ["123", /4 to 14 digits/],
      ["123456789012345", /4 to 14 digits/],
    ] as const) {
      fireEvent.change(screen.getByLabelText("Mobile number"), { target: { value: number } });
      fireEvent.click(screen.getByRole("button", { name: "Get verification code" }));
      await screen.findByText(message);
      assert.equal(screen.queryByLabelText("Verification code"), null);
      assert.equal(screen.getByLabelText("Mobile number").getAttribute("aria-invalid"), "true");
    }
  });
});

describe("real email authentication", { concurrency: false }, () => {
  it("restores the account name, opens account details and supports keyboard dismissal", async () => {
    const api = new AuthApi();
    api.authenticated = true;
    api.account.name = "Riya Sharma";
    await mount("/dashboard", api);
    const trigger = await screen.findByRole("button", { name: "Account menu for Riya Sharma" });
    assert.ok(trigger.textContent?.includes("RS"));
    fireEvent.keyDown(trigger, { key: "ArrowDown" });
    const menu = await screen.findByRole("menu");
    assert.ok(within(menu).getByText("user@example.com"));
    fireEvent.keyDown(menu, { key: "Escape" });
    await waitFor(() => assert.ok(screen.queryByRole("menu") === null));
    await waitFor(() => assert.ok(document.activeElement === trigger));
    fireEvent.keyDown(trigger, { key: "ArrowDown" });
    fireEvent.click(await screen.findByRole("menuitem", { name: "Account details" }));
    const dialog = await screen.findByRole("dialog", { name: "Account details" });
    assert.ok(within(dialog).getByText("Riya Sharma"));
    assert.ok(within(dialog).getByText("user@example.com"));
    fireEvent.keyDown(dialog, { key: "Escape" });
    await waitFor(() => assert.ok(screen.queryByRole("dialog") === null));
    await waitFor(() => assert.ok(document.activeElement === trigger));
  });

  it("uses the email as a name fallback and removes account controls on session expiry", async () => {
    const api = new AuthApi();
    api.authenticated = true;
    api.account.name = null;
    const app = await mount("/inventory", api);
    await screen.findByRole("button", { name: "Account menu for user" });
    api.authenticated = false;
    await act(async () => { await app.client.refetchQueries(); });
    await screen.findByRole("heading", { name: "Welcome home." });
    assert.ok(screen.queryByRole("button", { name: /Account menu for/ }) === null);
    assert.ok(screen.queryByText("user@example.com") === null);
  });

  it("keeps the session after a failed logout and prevents duplicate pending logout", async () => {
    const api = new AuthApi();
    api.authenticated = true;
    api.logoutFailure = true;
    await mount("/dashboard", api);
    fireEvent.keyDown(screen.getByRole("button", { name: /Account menu for/ }), { key: "ArrowDown" });
    fireEvent.click(await screen.findByRole("menuitem", { name: "Log out" }));
    await screen.findByRole("alert");
    assert.equal(api.authenticated, true);
    assert.ok(screen.getByRole("button", { name: "Account menu for User" }));
    api.logoutFailure = false;
    let release!: () => void;
    api.logoutGate = new Promise(resolve => { release = resolve; });
    try {
      fireEvent.keyDown(screen.getByRole("button", { name: /Account menu for/ }), { key: "ArrowDown" });
      fireEvent.click(await screen.findByRole("menuitem", { name: "Log out" }));
      const trigger = screen.getByRole("button", { name: /Account menu for/ }) as HTMLButtonElement;
      assert.ok(trigger.disabled);
      fireEvent.keyDown(trigger, { key: "ArrowDown" });
      assert.equal(api.requests.filter(request => request.path === "/api/auth/logout").length, 2);
      release();
      await screen.findByRole("heading", { name: "Welcome home." });
      assert.equal(api.authenticated, false);
      assert.ok(screen.queryByRole("button", { name: /Account menu for/ }) === null);
    } finally { release(); }
  });

  it("recovers a session when verification succeeds but its response is lost", async () => {
    const api = new AuthApi(); api.loseVerifyResponse = true;
    await mount("/login", api);
    await screen.findByRole("heading", { name: "Welcome home." });
    fireEvent.change(screen.getByLabelText("Email address"), { target: { value: "user@example.com" } });
    fireEvent.click(screen.getByRole("button", { name: "Get verification code" }));
    fireEvent.change(await screen.findByLabelText("Verification code"), { target: { value: "654321" } });
    fireEvent.click(screen.getByRole("button", { name: "Verify & continue" }));
    await screen.findByRole("heading", { name: "Dashboard" });
    assert.ok(screen.getByRole("button", { name: "Account menu for User" }));
    assert.equal(api.requests.filter(request => request.path === "/api/auth/verify").length, 1);
    assert.equal(api.requests.filter(request => request.path === "/api/auth/session").length, 2);
  });
  it("prevents duplicate submissions and shows server rate limits before a successful retry", async () => {
    const api = new AuthApi();
    let release!: () => void;
    api.codeGate = new Promise<void>(resolve => { release = resolve; });
    api.codeFailure = 429;
    await mount("/login", api);
    try {
      await screen.findByRole("heading", { name: "Welcome home." });
      fireEvent.change(screen.getByLabelText("Email address"), { target: { value: "user@example.com" } });
      assert.equal((screen.getByLabelText("Email address") as HTMLInputElement).value, "user@example.com");
      fireEvent.click(screen.getByRole("button", { name: "Get verification code" }));
      const pendingButton = await screen.findByRole("button", { name: "Sending code…" });
      fireEvent.submit(pendingButton.closest("form")!);
      await waitFor(() => assert.equal(api.requests.filter(request => request.path === "/api/auth/code").length, 1));
      assert.ok((pendingButton as HTMLButtonElement).disabled);
      release();
      await screen.findByText("Too many requests. Please wait before trying again.");
      api.codeGate = null; api.codeFailure = 0;
      fireEvent.click(screen.getByRole("button", { name: "Get verification code" }));
      await screen.findByLabelText("Verification code");
      assert.equal(api.requests.filter(request => request.path === "/api/auth/code").length, 2);
    } finally { release(); }
  });
  it("requires an emailed code, rejects the demo code, restores a session and logs out", async () => {
    const api = new AuthApi();
    const first = await mount("/inventory", api);
    try {
      await screen.findByRole("heading", { name: "Welcome home." });
      assert.equal(api.requests[0]?.path, "/api/auth/session");
      fireEvent.change(screen.getByLabelText("Email address"), { target: { value: "user@example.com" } });
      fireEvent.click(screen.getByRole("button", { name: "Get verification code" }));
      await screen.findByLabelText("Verification code");
      assert.equal(api.requests.find(request => request.path === "/api/auth/code")?.csrf, "anonymous-token");
      assert.equal(screen.queryByText(/Use demo code/), null);
      fireEvent.change(screen.getByLabelText("Verification code"), { target: { value: "123456" } });
      fireEvent.click(screen.getByRole("button", { name: "Verify & continue" }));
      await screen.findByText("Invalid code");
      assert.equal(api.authenticated, false);
      fireEvent.change(screen.getByLabelText("Verification code"), { target: { value: "654321" } });
      fireEvent.click(screen.getByRole("button", { name: "Verify & continue" }));
      await screen.findByRole("heading", { name: "Dashboard" });
      assert.equal(api.requests.filter(request => request.path === "/api/auth/verify").length, 2);
    } finally { first.unmount(); }
    const refreshed = await mount("/inventory", api);
    await screen.findByRole("heading", { name: "Inventory" });
    fireEvent.keyDown(screen.getByRole("button", { name: /Account menu for/ }), { key: "ArrowDown" });
    fireEvent.click(await screen.findByRole("menuitem", { name: "Log out" }));
    await screen.findByRole("heading", { name: "Welcome home." });
    assert.equal(api.requests.find(request => request.path === "/api/auth/logout")?.csrf, "signed-in-token");
    assert.equal(api.authenticated, false);
    await waitFor(() => assert.equal(refreshed.client.getQueryCache().getAll().length, 0));
  });

  it("keeps mobile verification an unauthenticated preview", async () => {
    mock.method(authFeatures, "mobilePreviewEnabled", () => true);
    const api = new AuthApi(); await mount("/login", api);
    await screen.findByRole("heading", { name: "Welcome home." });
    fireEvent.click(screen.getByRole("button", { name: "Mobile number" }));
    fireEvent.change(screen.getByLabelText("Mobile number"), { target: { value: "9876543210" } });
    fireEvent.click(screen.getByRole("button", { name: "Get verification code" }));
    fireEvent.change(await screen.findByLabelText("Verification code"), { target: { value: "123456" } });
    fireEvent.click(screen.getByRole("button", { name: "Verify & continue" }));
    await screen.findByText(/You are not signed in/);
    assert.equal(api.authenticated, false);
    assert.equal(api.requests.filter(request => request.path === "/api/auth/verify").length, 0);
    assert.equal(screen.queryByRole("heading", { name: "Dashboard" }), null);
  });
});
