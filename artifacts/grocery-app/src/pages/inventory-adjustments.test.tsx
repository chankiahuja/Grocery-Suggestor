import assert from "node:assert/strict";
import { afterEach, describe, it } from "node:test";
import React from "react";
import { JSDOM } from "jsdom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Router, Route, Switch } from "wouter";
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
  "localStorage",
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
const { cleanup, fireEvent, render, screen, waitFor, within } =
  await import("@testing-library/react");
const { default: Inventory } = await import("./inventory");
const { default: Dashboard } = await import("./dashboard");
const { AdjustmentFeedbackProvider } =
  await import("../components/adjustment-feedback");
const {
  getGetInventoryStatsQueryKey,
  getGetGrocerySuggestionsQueryKey,
  getGetInventoryItemQueryKey,
} = await import("@workspace/api-client-react");
const originalFetch = globalThis.fetch;
afterEach(() => {
  cleanup();
  localStorage.clear();
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
        <AdjustmentFeedbackProvider>
          <Switch>
            <Route path="/dashboard" component={Dashboard} />
            <Route path="/inventory" component={Inventory} />
          </Switch>
        </AdjustmentFeedbackProvider>
      </Router>
    </QueryClientProvider>,
  );
  return { queryClient };
}

describe("quick inventory adjustments", () => {
  it("names notification controls and returns focus to the bell on Escape or close", async () => {
    const api = new MockPantryApi();
    globalThis.fetch = api.fetch;
    const { queryClient } = renderApp("/inventory");
    try {
      const bell = await screen.findByTestId("notification-bell");
      fireEvent.click(bell);
      assert.equal(bell.getAttribute("aria-expanded"), "true");
      assert.ok(screen.getByRole("region", { name: "Notifications" }));
      assert.ok(screen.getByRole("button", { name: "Close notifications" }));
      fireEvent.keyDown(document, { key: "Escape" });
      assert.equal(bell.getAttribute("aria-expanded"), "false");
      assert.equal(document.activeElement, bell);

      fireEvent.click(bell);
      fireEvent.click(screen.getByRole("button", { name: "Close notifications" }));
      assert.equal(bell.getAttribute("aria-expanded"), "false");
      assert.equal(document.activeElement, bell);
    } finally {
      queryClient.clear();
    }
  });

  it("refreshes the visible notification snapshot and item detail after restock and Undo without SSE", async () => {
    const api = new MockPantryApi();
    globalThis.fetch = api.fetch;
    const { queryClient } = renderApp("/inventory");
    try {
      await screen.findByTestId("button-restock-1");
      queryClient.setQueryData(getGetInventoryItemQueryKey(1), api.state.inventory[0]);
      fireEvent.click(screen.getByTestId("notification-bell"));
      await within(screen.getByTestId("notification-panel")).findByText("Milk");
      fireEvent.click(screen.getByTestId("notification-bell"));
      fireEvent.click(screen.getByTestId("button-restock-1"));
      fireEvent.change(screen.getByLabelText("Amount (litres)"), { target: { value: "3" } });
      fireEvent.click(screen.getByRole("button", { name: "Restock" }));
      const undo = await screen.findByRole("button", { name: "Undo Milk" });
      assert.equal(queryClient.getQueryData<{ quantity: number }>(getGetInventoryItemQueryKey(1))?.quantity, 3);
      assert.equal(queryClient.getQueryState(getGetInventoryItemQueryKey(1))?.isInvalidated, true);
      fireEvent.click(screen.getByTestId("notification-bell"));
      await waitFor(() => assert.equal(within(screen.getByTestId("notification-panel")).queryByText("Milk"), null));
      fireEvent.click(undo);
      await screen.findByText(/Milk: adjustment undone/);
      await within(screen.getByTestId("notification-panel")).findByText("Milk");
      assert.equal(queryClient.getQueryData<{ quantity: number }>(getGetInventoryItemQueryKey(1))?.quantity, 0);
    } finally { queryClient.clear(); }
  });

  it("shows a server rejection without success feedback and permits a corrected request with a fresh key", async () => {
    const api = new MockPantryApi();
    const keys: string[] = [];
    globalThis.fetch = async (input, init) => {
      if (String(input).endsWith("/adjust")) {
        keys.push(new Headers(init?.headers).get("Idempotency-Key")!);
        if (keys.length === 1) return new Response(JSON.stringify({ error: "amount exceeds available stock" }), {
          status: 400, headers: { "Content-Type": "application/json" },
        });
      }
      return api.fetch(input, init);
    };
    const { queryClient } = renderApp("/inventory");
    try {
      fireEvent.click(await screen.findByTestId("button-consume-2"));
      fireEvent.click(screen.getByRole("button", { name: "Consume" }));
      assert.match((await screen.findByRole("alert")).textContent!, /amount exceeds available stock/);
      assert.equal(screen.queryByRole("button", { name: "Undo Eggs" }), null);
      assert.equal(api.state.inventory[1].quantity, 4);
      assert.equal((screen.getByLabelText("Amount (each)") as HTMLInputElement).disabled, false);
      fireEvent.change(screen.getByLabelText("Amount (each)"), { target: { value: "0.5" } });
      fireEvent.click(screen.getByRole("button", { name: "Consume" }));
      await screen.findByRole("button", { name: "Undo Eggs" });
      assert.equal(keys.length, 2);
      assert.ok(keys.every(Boolean));
      assert.notEqual(keys[0], keys[1]);
      assert.equal(api.state.inventory[1].quantity, 3.5);
    } finally { queryClient.clear(); }
  });

  async function consumeEggs() {
    fireEvent.click(await screen.findByTestId("button-consume-2"));
    const consumeSubmit = screen.getByRole("button", { name: "Consume" });
    fireEvent.click(consumeSubmit);
    await waitFor(() =>
      assert.ok(!screen.queryByTestId("dialog-adjust-inventory")),
    );
    return screen.findByRole("button", { name: "Undo Eggs" });
  }

  it("keeps Undo across navigation and refreshes dashboard, suggestions and filtered inventory without SSE", async () => {
    const api = new MockPantryApi();
    const reads: string[] = [];
    globalThis.fetch = async (input, init) => {
      if (!init?.method || init.method === "GET") reads.push(String(input));
      return api.fetch(input, init);
    };
    const { queryClient } = renderApp("/inventory");
    try {
      // These inactive caches must be stale even without an SSE connection.
      queryClient.setQueryData(getGetInventoryStatsQueryKey(), {
        totalItems: 999,
      });
      await consumeEggs();
      assert.equal(
        queryClient.getQueryState(getGetInventoryStatsQueryKey())
          ?.isInvalidated,
        true,
      );
      await waitFor(() =>
        assert.ok(
          reads.filter((path) => path === "/api/suggestions").length >= 2,
        ),
      );
      fireEvent.click(screen.getByTestId("nav-dashboard"));
      await waitFor(() =>
        assert.equal(
          queryClient.getQueryData<{ totalItems: number }>(
            getGetInventoryStatsQueryKey(),
          )?.totalItems,
          12,
        ),
      );
      const before = reads.filter(
        (path) => path === "/api/inventory/stats",
      ).length;
      fireEvent.click(screen.getByRole("button", { name: "Undo Eggs" }));
      await screen.findByText(/Eggs: adjustment undone/);
      await waitFor(() =>
        assert.ok(
          reads.filter((path) => path === "/api/inventory/stats").length >
            before,
        ),
      );
      assert.equal(api.state.inventory[1].quantity, 4);
      await waitFor(() =>
        assert.equal(
          queryClient.getQueryState(getGetGrocerySuggestionsQueryKey())
            ?.isInvalidated,
          false,
        ),
      );
      fireEvent.click(screen.getByTestId("nav-inventory"));
      await screen.findByTestId("inventory-item-2");
      assert.match(
        screen.getByTestId("inventory-item-2").textContent!,
        /4 each/,
      );
      fireEvent.click(screen.getByTestId("filter-out-of-stock"));
      fireEvent.click(await screen.findByTestId("button-restock-1"));
      fireEvent.change(screen.getByLabelText("Amount (litres)"), {
        target: { value: "3" },
      });
      fireEvent.click(screen.getByRole("button", { name: "Restock" }));
      await screen.findByRole("button", { name: "Undo Milk" });
      await waitFor(() => assert.ok(!screen.queryByTestId("inventory-item-1")));
      fireEvent.click(screen.getByRole("button", { name: "Undo Milk" }));
      await screen.findByText(/Milk: adjustment undone/);
      await screen.findByTestId("inventory-item-1");
      assert.match(
        screen.getByTestId("inventory-item-1").textContent!,
        /0 litres/,
      );
    } finally {
      queryClient.clear();
    }
  });

  for (const [status, message] of [
    [410, /Undo window has expired/],
    [409, /stock changed after this adjustment/],
    [404, /no longer available/],
  ] as const) {
    it(`explains Undo rejection ${status} and removes the action`, async () => {
      const api = new MockPantryApi();
      globalThis.fetch = async (input, init) =>
        String(input).endsWith("/undo")
          ? new Response(JSON.stringify({ error: "Rejected" }), {
              status,
              headers: { "Content-Type": "application/json" },
            })
          : api.fetch(input, init);
      const { queryClient } = renderApp("/inventory");
      try {
        fireEvent.click(await consumeEggs());
        await screen.findByText(message);
        assert.equal(screen.queryByRole("button", { name: "Undo Eggs" }), null);
        assert.equal(api.state.inventory[1].quantity, 3);
      } finally {
        queryClient.clear();
      }
    });
  }

  it("blocks duplicate Undo and retries a lost response using the original adjustment key", async () => {
    const api = new MockPantryApi();
    const undoBodies: string[] = [];
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    globalThis.fetch = async (input, init) => {
      const response = await api.fetch(input, init);
      if (String(input).endsWith("/undo")) {
        undoBodies.push(String(init?.body));
        if (undoBodies.length === 1) {
          await gate;
          throw new TypeError("Lost response");
        }
      }
      return response;
    };
    const { queryClient } = renderApp("/inventory");
    try {
      const undo = await consumeEggs();
      fireEvent.click(undo);
      fireEvent.click(undo);
      await waitFor(() => assert.equal(undoBodies.length, 1));
      assert.ok(
        (screen.getByRole("button", { name: "Undoing…" }) as HTMLButtonElement)
          .disabled,
      );
      release();
      await screen.findByText(/couldn't confirm Undo/);
      fireEvent.click(screen.getByRole("button", { name: "Undo Eggs" }));
      await screen.findByText(/this adjustment was already undone/);
      assert.equal(undoBodies.length, 2);
      assert.equal(undoBodies[0], undoBodies[1]);
      assert.equal(api.state.inventory[1].quantity, 4);
    } finally {
      release();
      queryClient.clear();
    }
  });

  it("bounds the local Undo window even when background timers have not fired", async () => {
    const api = new MockPantryApi();
    globalThis.fetch = api.fetch;
    const { queryClient } = renderApp("/inventory");
    const originalNow = Date.now;
    try {
      const undo = await consumeEggs();
      const later = originalNow() + 5 * 60_000;
      Date.now = () => later;
      fireEvent.click(undo);
      await screen.findByText(/Undo window has expired/);
      assert.equal(screen.queryByRole("button", { name: "Undo Eggs" }), null);
      assert.equal(api.state.inventory[1].quantity, 3);
    } finally {
      Date.now = originalNow;
      queryClient.clear();
    }
  });

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
        assert.ok(!screen.queryByTestId("dialog-adjust-inventory")),
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
        assert.ok(!screen.queryByTestId("dialog-adjust-inventory")),
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
        assert.ok(!screen.queryByTestId("dialog-adjust-inventory")),
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
