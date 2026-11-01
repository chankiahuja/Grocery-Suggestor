import assert from "node:assert/strict";
import { afterEach, describe, it } from "node:test";
import React from "react";
import { JSDOM } from "jsdom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Router } from "wouter";
import { memoryLocation } from "wouter/memory-location";
import { MockPantryApi } from "../mocks/pantry-api";

const dom = new JSDOM("<!doctype html><html><body></body></html>", {
  url: "http://localhost/inventory",
});
for (const key of [
  "window",
  "document",
  "navigator",
  "location",
  "history",
  "HTMLElement",
  "HTMLInputElement",
  "HTMLButtonElement",
  "HTMLSelectElement",
  "HTMLTextAreaElement",
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
const { cleanup, fireEvent, render, screen, waitFor } =
  await import("@testing-library/react");
const { default: Inventory } = await import("./inventory");
const originalFetch = globalThis.fetch;
afterEach(() => {
  cleanup();
  globalThis.fetch = originalFetch;
});
function renderApp(path: string) {
  const location = memoryLocation({ path });
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  render(
    <QueryClientProvider client={queryClient}>
      <Router hook={location.hook}>
        <Inventory />
      </Router>
    </QueryClientProvider>,
  );
  return { queryClient };
}

describe("quick inventory adjustments", () => {
  it("validates amounts and displays backend-confirmed consume/restock quantities", async () => {
    const api = new MockPantryApi();
    globalThis.fetch = api.fetch;
    const { queryClient } = renderApp("/inventory");
    try {
      await screen.findByTestId("button-consume-2");
      assert.ok(
        (screen.getByTestId("button-consume-1") as HTMLButtonElement).disabled,
      );
      fireEvent.click(screen.getByTestId("button-consume-2"));
      const amount = screen.getByLabelText("Amount (each)");
      for (const value of ["", "0", "-1", "5"]) {
        fireEvent.change(amount, { target: { value } });
        fireEvent.click(screen.getByRole("button", { name: "Consume" }));
        await screen.findByRole("alert");
        assert.equal(
          api.state.inventory.find((item) => item.id === 2)?.quantity,
          4,
        );
      }
      fireEvent.change(amount, { target: { value: "1.5" } });
      fireEvent.click(screen.getByRole("button", { name: "Consume" }));
      await waitFor(() =>
        assert.equal(screen.queryByTestId("dialog-adjust-inventory"), null),
      );
      assert.equal(
        api.state.inventory.find((item) => item.id === 2)?.quantity,
        2.5,
      );
      assert.match(
        screen.getByTestId("inventory-item-2").textContent!,
        /2.5 each/,
      );
      fireEvent.click(screen.getByTestId("button-restock-1"));
      fireEvent.change(screen.getByLabelText("Amount (litres)"), {
        target: { value: "2" },
      });
      fireEvent.click(screen.getByRole("button", { name: "Restock" }));
      await waitFor(() =>
        assert.equal(screen.queryByTestId("dialog-adjust-inventory"), null),
      );
      assert.match(
        screen.getByTestId("inventory-item-1").textContent!,
        /2 litres/,
      );
      fireEvent.click(screen.getByTestId("button-edit-1"));
      await screen.findByTestId("dialog-inventory-item");
    } finally {
      queryClient.clear();
    }
  });

  it("blocks duplicate submissions and safely retries an uncertain committed response", async () => {
    const api = new MockPantryApi();
    const keys: string[] = [];
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    globalThis.fetch = async (input, init) => {
      if (String(input).endsWith("/adjust")) {
        keys.push(new Headers(init?.headers).get("Idempotency-Key")!);
        const response = await api.fetch(input, init);
        if (keys.length === 1) {
          await gate;
          throw new TypeError("Connection lost after commit");
        }
        return response;
      }
      return api.fetch(input, init);
    };
    const { queryClient } = renderApp("/inventory");
    try {
      fireEvent.click(await screen.findByTestId("button-consume-2"));
      const submit = screen.getByRole("button", { name: "Consume" });
      fireEvent.click(submit);
      fireEvent.click(submit);
      await waitFor(() => assert.equal(keys.length, 1));
      assert.ok((submit as HTMLButtonElement).disabled);
      release();
      fireEvent.click(
        await screen.findByRole("button", { name: "Retry safely" }),
      );
      await waitFor(() =>
        assert.equal(screen.queryByTestId("dialog-adjust-inventory"), null),
      );
      assert.equal(keys.length, 2);
      assert.ok(keys[0]);
      assert.equal(keys[0], keys[1]);
      assert.equal(
        api.state.inventory.find((item) => item.id === 2)?.quantity,
        3,
      );
    } finally {
      release();
      queryClient.clear();
    }
  });
});
