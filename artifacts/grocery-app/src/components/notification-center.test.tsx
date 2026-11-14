import assert from "node:assert/strict";
import { afterEach, describe, it } from "node:test";
import React from "react";
import { JSDOM } from "jsdom";
import { MockPantryApi } from "../mocks/pantry-api";

const dom = new JSDOM("<!doctype html><html><body></body></html>", {
  url: "http://localhost/dashboard",
});
for (const key of [
  "window",
  "document",
  "navigator",
  "location",
  "history",
  "HTMLElement",
  "HTMLButtonElement",
  "Element",
  "Node",
  "Event",
  "MouseEvent",
  "KeyboardEvent",
  "MutationObserver",
  "getComputedStyle",
  "localStorage",
] as const) {
  Object.defineProperty(globalThis, key, {
    configurable: true,
    value: key === "window" ? dom.window : dom.window[key],
  });
}
Object.defineProperty(globalThis, "React", { configurable: true, value: React });
Object.defineProperty(globalThis, "IS_REACT_ACT_ENVIRONMENT", {
  configurable: true,
  writable: true,
  value: true,
});
dom.window.HTMLElement.prototype.scrollIntoView = () => {};

const { QueryClient, QueryClientProvider } = await import("@tanstack/react-query");
const { Router } = await import("wouter");
const { memoryLocation } = await import("wouter/memory-location");
const { act, cleanup, fireEvent, render, screen } = await import("@testing-library/react");
const { NotificationCenter } = await import("./notification-center");
const originalFetch = globalThis.fetch;

afterEach(() => {
  cleanup();
  globalThis.fetch = originalFetch;
  localStorage.clear();
});

async function openNotifications(api: MockPantryApi) {
  globalThis.fetch = api.fetch;
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: Infinity } },
  });
  const location = memoryLocation({ path: "/dashboard" });
  render(
    <QueryClientProvider client={client}>
      <Router hook={location.hook}>
        <NotificationCenter />
      </Router>
    </QueryClientProvider>,
  );
  await act(async () => {
    fireEvent.click(screen.getByRole("button", { name: "Notifications" }));
  });
  await screen.findByTestId("notification-email-reminder-note");
  return { client };
}

describe("NotificationCenter", { concurrency: false }, () => {
  it("shows the planned email reminder note with populated alerts without changing the count", async () => {
    const api = new MockPantryApi();
    const suggestions = await (await api.fetch("/api/suggestions")).json() as unknown[];
    const { client } = await openNotifications(api);

    assert.ok(api.state.inventory.length > 0);
    const panel = screen.getByTestId("notification-panel");
    assert.ok(panel.classList.contains("pantry-notification-panel"));
    assert.ok(screen.getByTestId("notification-panel-body").classList.contains("pantry-notification-panel-body"));
    assert.ok(screen.getByRole("heading", { name: "Email reminders — coming later" }));
    assert.ok(screen.getByText("Expiry reminders by email are planned for a future release. Check your alerts here for now."));
    assert.equal(
      (await screen.findByText(/\d+ alerts?/)).textContent,
      `${suggestions.length} alerts`,
    );
    client.clear();
  });

  it("shows the same ordinary informational note in the empty state", async () => {
    const api = new MockPantryApi();
    api.state.inventory = [];
    await openNotifications(api);

    await screen.findByText("All caught up!");
    assert.ok(screen.getByTestId("notification-email-reminder-note"));
    assert.ok(screen.getByRole("heading", { name: "Email reminders — coming later" }));
    assert.ok(screen.getByText("Expiry reminders by email are planned for a future release. Check your alerts here for now."));
    assert.equal(screen.queryByText(/\d+ alerts?/), null);
    assert.equal(screen.queryByRole("alert"), null);
  });

  it("keeps the close control available after opening the panel", async () => {
    await openNotifications(new MockPantryApi());

    const close = screen.getByRole("button", { name: "Close notifications" });
    fireEvent.click(close);

    assert.equal(screen.queryByTestId("notification-panel"), null);
    assert.equal(document.activeElement, screen.getByRole("button", { name: "Notifications" }));
  });
});
