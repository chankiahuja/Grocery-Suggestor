import assert from "node:assert/strict";
import { afterEach, describe, it } from "node:test";
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
});

class AuthApi {
  authenticated = false;
  csrf = "anonymous-token";
  requests: { path: string; method: string; csrf: string | null; body: Record<string, unknown> }[] = [];
  pantry = new MockPantryApi();
  codeFailure = 0;
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
      if (this.codeFailure) return json({ error: "Too many requests. Please wait before trying again." }, this.codeFailure);
      return json({ challengeId: "challenge-1", expiresAt: new Date(Date.now() + 300_000).toISOString(), resendAt: new Date(Date.now() + 30_000).toISOString() });
    }
    if (path === "/api/auth/verify") {
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

async function mount(path: string, api: AuthApi) {
  globalThis.fetch = api.fetch;
  const location = memoryLocation({ path });
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: Infinity }, mutations: { retry: false, gcTime: Infinity } } });
  clients.add(client);
  let view!: ReturnType<typeof render>;
  // Settle the initial async session check and route effects before entering input.
  await act(async () => {
    view = render(<QueryClientProvider client={client}><Router hook={location.hook}><AppRoutes /></Router></QueryClientProvider>);
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
