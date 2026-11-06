import assert from "node:assert/strict";
import { afterEach, describe, it } from "node:test";
import React from "react";
import { JSDOM } from "jsdom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Router } from "wouter";
import { memoryLocation } from "wouter/memory-location";
import { MockPantryApi } from "../mocks/pantry-api";

const dom = new JSDOM("<!doctype html><html><body></body></html>", {
  url: "http://localhost/",
});
for (const key of [
  "window",
  "document",
  "navigator",
  "location",
  "history",
  "localStorage",
  "HTMLElement",
  "HTMLInputElement",
  "HTMLButtonElement",
  "Element",
  "Node",
  "Event",
  "MouseEvent",
  "CustomEvent",
  "KeyboardEvent",
  "NodeFilter",
  "MutationObserver",
  "getComputedStyle",
] as const) {
  Object.defineProperty(globalThis, key, {
    configurable: true,
    value: key === "window" ? dom.window : dom.window[key],
  });
}
Object.defineProperty(globalThis, "React", {
  configurable: true,
  value: React,
});
Object.defineProperty(globalThis, "IS_REACT_ACT_ENVIRONMENT", {
  configurable: true,
  writable: true,
  value: true,
});
dom.window.HTMLElement.prototype.scrollIntoView = () => {};

const { cleanup, fireEvent, render, screen, within } =
  await import("@testing-library/react");
const { default: ComparePrices } = await import("./compare-prices");
const originalFetch = globalThis.fetch;

afterEach(() => {
  cleanup();
  localStorage.clear();
  globalThis.fetch = originalFetch;
});

function renderCompare(path: string, api = new MockPantryApi()) {
  globalThis.fetch = api.fetch;
  const location = memoryLocation({ path });
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  render(
    <QueryClientProvider client={queryClient}>
      <Router hook={location.hook}>
        <ComparePrices />
      </Router>
    </QueryClientProvider>,
  );
  return { api, queryClient };
}

describe("Compare Prices demo", () => {
  it("shows fixed sample quotes and a route back to Shopping Lists without a list", () => {
    const { queryClient } = renderCompare("/compare-prices");
    assert.ok(
      screen
        .getAllByRole("link", { name: "Back to Shopping Lists" })
        .every((link) => link.getAttribute("href") === "/shopping-lists"),
    );
    assert.equal(
      screen.getByTestId("nav-compare-prices").getAttribute("href"),
      "/compare-prices",
    );
    assert.ok(screen.getByText("Illustrative prices only."));
    assert.ok(screen.getByText("₹762"));
    assert.ok(screen.getByText("Lowest sample subtotal"));
    assert.equal(
      within(
        screen.getByRole("region", { name: "Matched sample items" }),
      ).getAllByRole("listitem").length,
      3,
    );
    queryClient.clear();
  });

  it("shows the selected list from listId and returns to that list without changing sample quotes", async () => {
    const { queryClient } = renderCompare("/compare-prices?listId=20");
    const selected = await screen.findByRole("region", {
      name: "Items in Weekend groceries",
    });
    assert.equal(within(selected).getAllByRole("listitem").length, 2);
    assert.ok(within(selected).getByText("Milk"));
    assert.ok(within(selected).getByText("Rice"));
    assert.ok(
      screen
        .getAllByRole("link", { name: "Back to Weekend groceries" })
        .every((link) => link.getAttribute("href") === "/shopping-lists/20"),
    );
    assert.ok(screen.getByText("₹762"));
    assert.equal(
      within(
        screen.getByRole("region", { name: "Matched sample items" }),
      ).getAllByRole("listitem").length,
      3,
    );
    queryClient.clear();
  });

  it("keeps the sample view available and offers retry when list context cannot load", async () => {
    const api = new MockPantryApi();
    const { queryClient } = renderCompare("/compare-prices?listId=999", api);
    await screen.findByText("List unavailable");
    assert.ok(screen.getByRole("button", { name: "Try again" }));
    assert.ok(screen.getByText("₹762"));
    assert.ok(
      screen
        .getAllByRole("link", { name: "Back to Shopping Lists" })
        .every((link) => link.getAttribute("href") === "/shopping-lists"),
    );
    fireEvent.click(screen.getByRole("button", { name: "Try again" }));
    queryClient.clear();
  });
});
