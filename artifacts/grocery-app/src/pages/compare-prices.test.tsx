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

const { cleanup, fireEvent, render, screen, waitFor, within } =
  await import("@testing-library/react");
const { default: ComparePrices } = await import("./compare-prices");
const originalFetch = globalThis.fetch;

afterEach(() => {
  cleanup();
  localStorage.clear();
  globalThis.fetch = originalFetch;
});

function renderCompare(
  path: string,
  api = new MockPantryApi(),
  fetchImpl: typeof fetch = api.fetch,
) {
  globalThis.fetch = fetchImpl;
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
    let requests = 0;
    let completedRequests = 0;
    let releaseRetry!: () => void;
    const retryGate = new Promise<void>((resolve) => {
      releaseRetry = resolve;
    });
    const fetchImpl: typeof fetch = async (input, init) => {
      const isListRequest =
        new URL(
          input instanceof Request ? input.url : String(input),
          "http://localhost",
        ).pathname === "/api/shopping-lists/999";
      if (isListRequest && ++requests === 2) await retryGate;
      const response = await api.fetch(input, init);
      if (isListRequest) completedRequests++;
      return response;
    };
    const { queryClient } = renderCompare(
      "/compare-prices?listId=999",
      api,
      fetchImpl,
    );
    await screen.findByText("List unavailable");
    assert.equal(requests, 1);
    assert.equal(completedRequests, 1);
    fireEvent.click(screen.getByRole("button", { name: "Try again" }));
    await waitFor(() => {
      assert.equal(requests, 2);
      assert.equal(completedRequests, 1);
    });
    releaseRetry();
    await waitFor(() => {
      assert.equal(completedRequests, 2);
      assert.equal(
        queryClient.getQueryState(["/api/shopping-lists/999"])?.fetchStatus,
        "idle",
      );
      assert.ok(screen.getByText("List unavailable"));
      assert.ok(screen.getByRole("button", { name: "Try again" }));
      assert.ok(screen.getByText("₹762"));
      assert.ok(
        screen
          .getAllByRole("link", { name: "Back to Shopping Lists" })
          .every((link) => link.getAttribute("href") === "/shopping-lists"),
      );
    });
    queryClient.clear();
  });
});
