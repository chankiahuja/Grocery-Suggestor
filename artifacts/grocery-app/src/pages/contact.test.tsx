import assert from "node:assert/strict";
import { afterEach, describe, it } from "node:test";
import React from "react";
import { JSDOM } from "jsdom";

const dom = new JSDOM("<!doctype html><html><body></body></html>", { url: "http://localhost/contact" });
for (const key of ["window", "document", "navigator", "location", "history", "HTMLElement", "HTMLInputElement", "HTMLButtonElement", "HTMLSelectElement", "HTMLTextAreaElement", "Element", "Node", "Event", "MouseEvent", "CustomEvent", "KeyboardEvent", "NodeFilter", "MutationObserver", "getComputedStyle", "localStorage"] as const) {
  Object.defineProperty(globalThis, key, { configurable: true, value: key === "window" ? dom.window : dom.window[key] });
}
Object.defineProperty(globalThis, "React", { configurable: true, value: React });
Object.defineProperty(globalThis, "IS_REACT_ACT_ENVIRONMENT", { configurable: true, writable: true, value: true });
dom.window.HTMLElement.prototype.scrollIntoView = () => {};
const { QueryClient, QueryClientProvider } = await import("@tanstack/react-query");
const { Router } = await import("wouter");
const { memoryLocation } = await import("wouter/memory-location");
const { setCsrfToken } = await import("@workspace/api-client-react");
const { act, cleanup, fireEvent, render, screen, waitFor } = await import("@testing-library/react");
const { AppRoutes } = await import("../App");
const { QuickFeedbackDialog } = await import("../components/quick-feedback-dialog");
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

class FeedbackApi {
  authenticated = false;
  supportEmail: string | null = "help@example.test";
  responseTime: string | null = "We aim to respond within two business days.";
  failNext = false;
  requests: { path: string; method: string; body: Record<string, unknown>; csrf: string | null }[] = [];

  fetch = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const path = new URL(String(input), "http://localhost").pathname;
    const method = (init?.method ?? "GET").toUpperCase();
    const csrf = new Headers(init?.headers).get("X-CSRF-TOKEN");
    const body = init?.body ? JSON.parse(String(init.body)) as Record<string, unknown> : {};
    this.requests.push({ path, method, body, csrf });
    const json = (value: unknown, status = 200) => new Response(JSON.stringify(value), { status, headers: { "Content-Type": "application/json" } });
    if (path === "/api/auth/session") {
      return json({
        authenticated: this.authenticated,
        account: this.authenticated ? { id: 8, email: "signed-in@example.test", name: "Signed In" } : null,
        csrfToken: "test-csrf",
      });
    }
    if (path === "/api/feedback/config") return json({ supportEmail: this.supportEmail, responseTime: this.responseTime });
    if (path === "/api/feedback" && method === "POST") {
      if (csrf !== "test-csrf") return json({ error: "CSRF missing" }, 403);
      if (!this.supportEmail) return json({ error: "Support is not configured" }, 503);
      if (this.failNext) {
        this.failNext = false;
        return json({ error: "Mail unavailable" }, 503);
      }
      return json({ accepted: true });
    }
    return json({ error: `Unexpected request ${method} ${path}` }, 404);
  };
}

async function mountContact(api: FeedbackApi, preview = false) {
  globalThis.fetch = api.fetch;
  if (preview) setCsrfToken("test-csrf");
  const location = memoryLocation({ path: "/contact" });
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: Infinity }, mutations: { retry: false, gcTime: Infinity } } });
  clients.add(client);
  let view!: ReturnType<typeof render>;
  await act(async () => {
    view = render(<QueryClientProvider client={client}><Router hook={location.hook}><AppRoutes preview={preview} /></Router></QueryClientProvider>);
  });
  return { ...view, client, location };
}

describe("Contact & Feedback", { concurrency: false }, () => {
  it("submits a categorized message with the signed-in reply email prefilled and editable", async () => {
    const api = new FeedbackApi();
    api.authenticated = true;
    await mountContact(api);

    await screen.findByRole("heading", { name: "We're here to help" });
    assert.equal((await screen.findByLabelText("Contact email (optional)") as HTMLInputElement).value, "signed-in@example.test");
    assert.equal((await screen.findByRole("link", { name: "help@example.test" })).getAttribute("href"), "mailto:help@example.test");
    await screen.findByText("We aim to respond within two business days.");
    fireEvent.change(screen.getByLabelText("Category"), { target: { value: "idea" } });
    fireEvent.change(screen.getByLabelText("Subject (optional)"), { target: { value: "Small suggestion" } });
    fireEvent.change(screen.getByLabelText("Message Required"), { target: { value: "Please add this." } });
    fireEvent.change(screen.getByLabelText("Contact email (optional)"), { target: { value: "reply@example.test" } });
    fireEvent.click(screen.getByRole("button", { name: "Send message" }));

    await screen.findByRole("heading", { name: "Message sent" });
    const request = api.requests.find(item => item.path === "/api/feedback" && item.method === "POST");
    assert.deepEqual(request?.body, {
      category: "idea",
      subject: "Small suggestion",
      message: "Please add this.",
      email: "reply@example.test",
    });
    assert.equal(request?.csrf, "test-csrf");
  });

  it("preserves values after a failed request and offers a configured mailto retry", async () => {
    const api = new FeedbackApi();
    api.failNext = true;
    await mountContact(api);
    await screen.findByRole("heading", { name: "We're here to help" });
    fireEvent.change(screen.getByLabelText("Message Required"), { target: { value: "Keep my text" } });
    fireEvent.click(screen.getByRole("button", { name: "Send message" }));

    await screen.findByRole("alert");
    assert.equal((screen.getByLabelText("Message Required") as HTMLTextAreaElement).value, "Keep my text");
    const mailto = screen.getByRole("link", { name: "Email support instead" }).getAttribute("href") ?? "";
    assert.match(mailto, /^mailto:help@example\.test\?subject=PantryPal%20feedback&body=/);
    assert.match(mailto, /Keep%20my%20text$/);
    assert.equal(mailto.includes("+"), false);
    fireEvent.click(screen.getByRole("button", { name: "Try again" }));
    await screen.findByRole("heading", { name: "Message sent" });
    assert.equal(api.requests.filter(item => item.path === "/api/feedback" && item.method === "POST").length, 2);
  });

  it("shows field-level validation before sending", async () => {
    const api = new FeedbackApi();
    await mountContact(api);
    await screen.findByRole("heading", { name: "We're here to help" });
    fireEvent.click(screen.getByRole("button", { name: "Send message" }));
    await screen.findByText("Enter a message.");
    fireEvent.change(screen.getByLabelText("Message Required"), { target: { value: "A message" } });
    fireEvent.change(screen.getByLabelText("Contact email (optional)"), { target: { value: "invalid" } });
    fireEvent.click(screen.getByRole("button", { name: "Send message" }));
    await screen.findByText("Enter a valid email address.");
    assert.equal(api.requests.some(item => item.path === "/api/feedback" && item.method === "POST"), false);
  });

  it("shows a neutral contact state when no support address is configured", async () => {
    const api = new FeedbackApi();
    api.supportEmail = null;
    api.responseTime = null;
    await mountContact(api, true);
    await screen.findByRole("heading", { name: "We're here to help" });
    await screen.findByText("A support email address has not been configured yet. Please try again later.");
    assert.equal(screen.queryByRole("link", { name: /@/ }), null);
    fireEvent.change(screen.getByLabelText("Message Required"), { target: { value: "A draft" } });
    assert.equal((screen.getByRole("button", { name: "Send message" }) as HTMLButtonElement).disabled, true);
    assert.equal((screen.getByLabelText("Message Required") as HTMLTextAreaElement).value, "A draft");
    assert.equal(api.requests.some(item => item.path === "/api/feedback" && item.method === "POST"), false);
  });

  it("opens an accessible compact dialog with a route to the full page", async () => {
    const api = new FeedbackApi();
    globalThis.fetch = api.fetch;
    setCsrfToken("test-csrf");
    const location = memoryLocation({ path: "/dashboard" });
    const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: Infinity } } });
    clients.add(client);
    render(
      <QueryClientProvider client={client}>
        <Router hook={location.hook}>
          <QuickFeedbackDialog email="signed-in@example.test" open onOpenChange={() => {}} />
        </Router>
      </QueryClientProvider>,
    );
    await screen.findByRole("dialog", { name: "Share feedback" });
    assert.equal((await screen.findByLabelText("Reply email (optional)") as HTMLInputElement).value, "signed-in@example.test");
    assert.ok(screen.getByRole("link", { name: "Contact & Feedback page" }));
    assert.ok(screen.getByRole("button", { name: "Send feedback" }));
  });
});
