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
const { act, cleanup, fireEvent, render, screen, waitFor } = await import("@testing-library/react");
const { AppRoutes } = await import("../App");
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
  readonly fetch = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const path = new URL(String(input), "http://localhost").pathname;
    const method = (init?.method || "GET").toUpperCase();
    const csrf = new Headers(init?.headers).get("X-CSRF-TOKEN");
    const body = init?.body ? JSON.parse(String(init.body)) as Record<string, unknown> : {};
    this.requests.push({ path, method, csrf, body });
    const json = (value: unknown, status = 200) => new Response(JSON.stringify(value), { status, headers: { "Content-Type": "application/json" } });
    if (path === "/api/auth/session" && method === "GET")
      return json({ authenticated: this.authenticated, account: this.authenticated ? { id: 1, email: "user@example.com", name: "User" } : null, csrfToken: this.csrf });
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
      return json({ authenticated: true, account: { id: 1, email: "user@example.com", name: "User" }, csrfToken: this.csrf });
    }
    if (path === "/api/auth/logout") {
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

describe("real email authentication", { concurrency: false }, () => {
  it("recovers a session when verification succeeds but its response is lost", async () => {
    const api = new AuthApi(); api.loseVerifyResponse = true;
    await mount("/login", api);
    await screen.findByRole("heading", { name: "Welcome home." });
    fireEvent.change(screen.getByLabelText("Email address"), { target: { value: "user@example.com" } });
    fireEvent.click(screen.getByRole("button", { name: "Get verification code" }));
    fireEvent.change(await screen.findByLabelText("Verification code"), { target: { value: "654321" } });
    fireEvent.click(screen.getByRole("button", { name: "Verify & continue" }));
    await screen.findByRole("heading", { name: "Dashboard" });
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
    fireEvent.click(screen.getByRole("button", { name: "Logout" }));
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
