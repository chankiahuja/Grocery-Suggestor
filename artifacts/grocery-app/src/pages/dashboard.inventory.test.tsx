import assert from "node:assert/strict";
import { afterEach, beforeEach, describe, it, mock } from "node:test";
import { authFeatures } from "../lib/auth-features";
import React from "react";
import { MockPantryApi } from "../mocks/pantry-api";
import { JSDOM } from "jsdom";
import type { InventoryItem, ShoppingListWithItems } from "@workspace/api-client-react";

const dom = new JSDOM("<!doctype html><html><body></body></html>", {
  url: "http://localhost/",
});

Object.defineProperties(globalThis, {
  window: { configurable: true, value: dom.window },
  document: { configurable: true, value: dom.window.document },
  navigator: { configurable: true, value: dom.window.navigator },
  location: { configurable: true, value: dom.window.location },
  history: { configurable: true, value: dom.window.history },
  React: { configurable: true, value: React },
  addEventListener: {
    configurable: true,
    value: dom.window.addEventListener.bind(dom.window),
  },
  removeEventListener: {
    configurable: true,
    value: dom.window.removeEventListener.bind(dom.window),
  },
  dispatchEvent: {
    configurable: true,
    value: dom.window.dispatchEvent.bind(dom.window),
  },
  HTMLElement: { configurable: true, value: dom.window.HTMLElement },
  HTMLInputElement: { configurable: true, value: dom.window.HTMLInputElement },
  HTMLButtonElement: {
    configurable: true,
    value: dom.window.HTMLButtonElement,
  },
  HTMLSelectElement: {
    configurable: true,
    value: dom.window.HTMLSelectElement,
  },
  HTMLTextAreaElement: {
    configurable: true,
    value: dom.window.HTMLTextAreaElement,
  },
  Element: { configurable: true, value: dom.window.Element },
  Node: { configurable: true, value: dom.window.Node },
  Event: { configurable: true, value: dom.window.Event },
  MouseEvent: { configurable: true, value: dom.window.MouseEvent },
  CustomEvent: { configurable: true, value: dom.window.CustomEvent },
  KeyboardEvent: { configurable: true, value: dom.window.KeyboardEvent },
  NodeFilter: { configurable: true, value: dom.window.NodeFilter },
  MutationObserver: { configurable: true, value: dom.window.MutationObserver },
  getComputedStyle: { configurable: true, value: dom.window.getComputedStyle },
  IS_REACT_ACT_ENVIRONMENT: { configurable: true, value: true, writable: true },
});

dom.window.HTMLElement.prototype.scrollIntoView = () => {};

// Initialize browser-sensitive dependencies only after JSDOM is installed.
const { QueryClient, QueryClientProvider } = await import("@tanstack/react-query");
const { Route, Router, Switch } = await import("wouter");
const { memoryLocation } = await import("wouter/memory-location");
const {
  getGetGrocerySuggestionsQueryKey,
  getGetInventoryStatsQueryKey,
  getGetShoppingListQueryKey,
  getListInventoryItemsQueryKey,
  getListShoppingListsQueryKey,
} = await import("@workspace/api-client-react");
const { act, cleanup, fireEvent, render, screen, waitFor, within } =
  await import("@testing-library/react");
const { useToast } = await import("../hooks/use-toast");
const [
  { default: Dashboard },
  { default: Inventory },
  { default: ShoppingLists },
  { default: ShoppingListDetail },
  { PreviewAuth: Auth },
  { AppRoutes },
] = await Promise.all([
  import("./dashboard"),
  import("./inventory"),
  import("./shopping-lists"),
  import("./shopping-list-detail"),
  import("./auth"),
  import("../App"),
]);
const originalFetch = globalThis.fetch;
const clients = new Set<InstanceType<typeof QueryClient>>();
function createQueryClient(options?: ConstructorParameters<typeof QueryClient>[0]) {
  const client = new QueryClient({
    ...options,
    defaultOptions: {
      queries: { retry: false, gcTime: Infinity, ...options?.defaultOptions?.queries },
      mutations: { retry: false, gcTime: Infinity, ...options?.defaultOptions?.mutations },
    },
  });
  clients.add(client);
  return client;
}
const timestamp = "2026-10-26T12:00:00.000Z";

function dashboardItem(
  id: number,
  name: string,
  category: string,
  quantity: number,
  minThreshold: number,
  expiresInDays: number | null = null,
): InventoryItem {
  const expiresAt =
    expiresInDays === null
      ? null
      : new Date(Date.now() + expiresInDays * 24 * 60 * 60 * 1000)
          .toISOString()
          .slice(0, 10);

  return {
    id,
    name,
    category,
    quantity,
    unit: "each",
    minThreshold,
    expiresAt,
    notes: null,
    revision: 0,
    createdAt: timestamp,
    updatedAt: timestamp,
  };
}

class GroceryApiMock {
  items: InventoryItem[] = [];
  inventoryCreateBodies: Record<string, unknown>[] = [];
  inventoryCreateMode: "normal" | "pending" | "error" = "normal";
  private pendingCreates: Array<{
    resolve: () => void;
    reject: () => void;
  }> = [];
  resolvePendingCreate: (() => void) | null = null;
  rejectPendingCreate: (() => void) | null = null;
  inventoryUpdateBodies: Record<string, unknown>[] = [];
  inventoryGetMode: "normal" | "pending" | "error" = "normal";
  shoppingList: ShoppingListWithItems = {
    id: 1,
    name: "Weekly shop",
    items: [
      {
        id: 1,
        shoppingListId: 1,
        inventoryItemId: 1,
        name: "Rice",
        category: "Pantry",
        quantity: 5,
        unit: "bags",
        purchased: true,
        notes: null,
      },
    ],
    createdAt: timestamp,
    updatedAt: timestamp,
  };
  generatedShoppingList: ShoppingListWithItems | null = null;
  private nextInventoryId = 1;

  private refreshPendingCreateControls() {
    if (this.pendingCreates.length === 0) {
      this.resolvePendingCreate = null;
      this.rejectPendingCreate = null;
      return;
    }

    this.resolvePendingCreate = () => {
      this.pendingCreates.shift()?.resolve();
      this.refreshPendingCreateControls();
    };
    this.rejectPendingCreate = () => {
      this.pendingCreates.shift()?.reject();
      this.refreshPendingCreateControls();
    };
  }

  readonly fetch = async (
    input: RequestInfo | URL,
    init?: RequestInit,
  ): Promise<Response> => {
    const url = new URL(
      typeof input === "string" ? input : input.toString(),
      "http://localhost",
    );
    const method = (init?.method ?? "GET").toUpperCase();

    if (url.pathname === "/api/inventory" && method === "GET") {
      if (this.inventoryGetMode === "error") {
        return this.json({ error: "Inventory unavailable" }, 500);
      }
      if (this.inventoryGetMode === "pending") {
        return new Promise<Response>((_, reject) => {
          const signal = init?.signal;
          const abort = () =>
            reject(new DOMException("Request aborted", "AbortError"));
          if (signal?.aborted) {
            abort();
          } else {
            signal?.addEventListener("abort", abort, { once: true });
          }
        });
      }

      let items = [...this.items];
      if (url.searchParams.get("lowStock") === "true") {
        items = items.filter(
          (item) => item.quantity > 0 && item.quantity <= item.minThreshold,
        );
      }
      if (url.searchParams.get("outOfStock") === "true") {
        items = items.filter((item) => item.quantity === 0);
      }
      return this.json(items);
    }

    if (url.pathname === "/api/inventory" && method === "POST") {
      const input = this.readBody(init);
      this.inventoryCreateBodies.push(input);
      const createItem = () => {
        if (this.inventoryCreateMode === "error") {
          return this.json({ error: "Inventory unavailable" }, 500);
        }
        const item: InventoryItem = {
          id: this.nextInventoryId++,
          name: String(input.name),
          category: String(input.category),
          quantity: Number(input.quantity),
          unit: String(input.unit),
          minThreshold: Number(input.minThreshold),
          expiresAt: input.expiresAt ? String(input.expiresAt) : null,
          notes: input.notes ? String(input.notes) : null,
          revision: 0,
          createdAt: timestamp,
          updatedAt: timestamp,
        };
        this.items.push(item);
        return this.json(item, 201);
      };
      if (this.inventoryCreateMode === "pending") {
        return new Promise<Response>((resolve, reject) => {
          const pending = {
            resolve: () => resolve(createItem()),
            reject: () => reject(new Error("Inventory request rejected")),
          };
          this.pendingCreates.push(pending);
          this.refreshPendingCreateControls();
        });
      }
      return createItem();
    }

    if (url.pathname === "/api/inventory/stats" && method === "GET") {
      const today = new Date().toISOString().slice(0, 10);
      const sevenDaysFromNow = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000)
        .toISOString()
        .slice(0, 10);
      return this.json({
        totalItems: this.items.length,
        lowStockCount: this.items.filter(
          (item) => item.quantity > 0 && item.quantity <= item.minThreshold,
        ).length,
        outOfStockCount: this.items.filter((item) => item.quantity === 0)
          .length,
        expiringCount: this.items.filter(
          (item) =>
            item.expiresAt != null &&
            item.expiresAt >= today &&
            item.expiresAt <= sevenDaysFromNow,
        ).length,
        categoryBreakdown: [],
      });
    }

    const inventoryItemMatch = url.pathname.match(/^\/api\/inventory\/(\d+)$/);
    if (inventoryItemMatch && method === "PATCH") {
      const id = Number(inventoryItemMatch[1]);
      const item = this.items.find((candidate) => candidate.id === id);
      if (!item) return this.json({ error: "Item not found" }, 404);
      const update = this.readBody(init);
      if (typeof update.revision !== "number" || update.revision !== item.revision)
        return this.json({ error: "Inventory item was modified; reload and try again" }, 409);
      this.inventoryUpdateBodies.push(update);
      const { revision: _revision, ...fields } = update;
      Object.assign(item, fields, { updatedAt: timestamp });
      item.revision += 1;
      return this.json(item);
    }
    if (inventoryItemMatch && method === "DELETE") {
      const id = Number(inventoryItemMatch[1]);
      this.items = this.items.filter((item) => item.id !== id);
      return new Response(null, { status: 204 });
    }

    if (url.pathname === "/api/suggestions" && method === "GET") {
      return this.json(
        this.items.flatMap((item) => {
          if (item.quantity === 0) {
            return [
              {
                inventoryItemId: item.id,
                name: item.name,
                category: item.category,
                currentQuantity: item.quantity,
                minThreshold: item.minThreshold,
                unit: item.unit,
                reason: "Out of stock",
                urgency: "critical",
              },
            ];
          }
          if (item.quantity <= item.minThreshold) {
            return [
              {
                inventoryItemId: item.id,
                name: item.name,
                category: item.category,
                currentQuantity: item.quantity,
                minThreshold: item.minThreshold,
                unit: item.unit,
                reason: `${item.quantity} ${item.unit} left`,
                urgency: "low",
              },
            ];
          }
          return [];
        }),
      );
    }

    if (
      url.pathname === "/api/suggestions/generate-list" &&
      method === "POST"
    ) {
      const suggestedItems = this.items.filter(
        (item) => item.quantity === 0 || item.quantity <= item.minThreshold,
      );
      if (suggestedItems.length === 0) {
        return this.json(
          { error: "No low-stock suggestions are available." },
          400,
        );
      }
      this.generatedShoppingList = {
        id: 2,
        name: "Low-stock shopping list",
        items: suggestedItems.map((item, index) => ({
          id: index + 2,
          shoppingListId: 2,
          inventoryItemId: item.id,
          name: item.name,
          category: item.category,
          quantity: Math.max(item.minThreshold - item.quantity, 1),
          unit: item.unit,
          purchased: false,
          notes:
            item.quantity === 0
              ? "Out of stock"
              : `${item.quantity} ${item.unit} left`,
        })),
        createdAt: timestamp,
        updatedAt: timestamp,
      };
      return this.json(this.generatedShoppingList, 201);
    }

    if (url.pathname === "/api/shopping-lists" && method === "GET") {
      const lists = [
        {
          id: this.shoppingList.id,
          name: this.shoppingList.name,
          itemCount: this.shoppingList.items.length,
          purchasedCount: this.shoppingList.items.filter(
            (item) => item.purchased,
          ).length,
          createdAt: timestamp,
          updatedAt: timestamp,
        },
      ];
      if (this.generatedShoppingList) {
        lists.push({
          id: this.generatedShoppingList.id,
          name: this.generatedShoppingList.name,
          itemCount: this.generatedShoppingList.items.length,
          purchasedCount: this.generatedShoppingList.items.filter(
            (item) => item.purchased,
          ).length,
          createdAt: timestamp,
          updatedAt: timestamp,
        });
      }
      return this.json(lists);
    }

    const requestedShoppingListId = Number(
      url.pathname.match(/^\/api\/shopping-lists\/(\d+)$/)?.[1],
    );
    if (method === "GET" && requestedShoppingListId) {
      const list =
        requestedShoppingListId === this.shoppingList.id
          ? this.shoppingList
          : requestedShoppingListId === this.generatedShoppingList?.id
            ? this.generatedShoppingList
            : null;
      if (list) return this.json(list);
    }

    const itemUpdateMatch = url.pathname.match(
      /^\/api\/shopping-lists\/(\d+)\/items\/(\d+)$/,
    );
    if (itemUpdateMatch && method === "PATCH") {
      const list =
        Number(itemUpdateMatch[1]) === this.generatedShoppingList?.id
          ? this.generatedShoppingList
          : null;
      const item = list?.items.find(
        (candidate) => candidate.id === Number(itemUpdateMatch[2]),
      );
      if (!list || !item) return this.json({ error: "Item not found" }, 404);
      Object.assign(item, this.readBody(init));
      return this.json(item);
    }

    const purchaseMatch = url.pathname.match(
      /^\/api\/shopping-lists\/(\d+)\/purchase$/,
    );
    if (purchaseMatch && method === "POST") {
      const list =
        Number(purchaseMatch[1]) === this.shoppingList.id
          ? this.shoppingList
          : Number(purchaseMatch[1]) === this.generatedShoppingList?.id
            ? this.generatedShoppingList
            : null;
      if (!list) return this.json({ error: "List not found" }, 404);
      let updatedInventoryItems = 0;
      const purchasedItems = list.items.filter(
        (item) => item.purchased && item.inventoryItemId !== null,
      );
      for (const shoppingItem of purchasedItems) {
        const inventoryItem = this.items.find(
          (item) => item.id === shoppingItem.inventoryItemId,
        );
        if (!inventoryItem) continue;
        inventoryItem.quantity += shoppingItem.quantity;
        inventoryItem.revision += 1;
        updatedInventoryItems += 1;
      }
      return this.json({
        purchasedCount: purchasedItems.length,
        updatedInventoryItems,
      });
    }

    return this.json(
      { error: `Unhandled mock request: ${method} ${url.pathname}` },
      404,
    );
  };

  private readBody(init?: RequestInit): Record<string, unknown> {
    return JSON.parse(String(init?.body ?? "{}")) as Record<string, unknown>;
  }

  private json(value: unknown, status = 200): Response {
    return new Response(JSON.stringify(value), {
      status,
      headers: { "Content-Type": "application/json" },
    });
  }
}

function renderApp(path = "/dashboard") {
  const location = memoryLocation({ path });
  const queryClient = createQueryClient({
    defaultOptions: {
      queries: { retry: false, staleTime: 0 },
      mutations: { retry: false },
    },
  });

  return {
    queryClient,
    ...render(
      <QueryClientProvider client={queryClient}>
        <Router hook={location.hook}>
          <Switch>
            <Route path="/login" component={Auth} />
            <Route path="/signup" component={Auth} />
            <Route path="/dashboard" component={Dashboard} />
            <Route path="/inventory" component={Inventory} />
            <Route path="/shopping-lists" component={ShoppingLists} />
            <Route path="/shopping-lists/:id" component={ShoppingListDetail} />
          </Switch>
        </Router>
      </QueryClientProvider>,
    ),
  };
}

describe("inventory save and continue", () => {
  it("advances both pending create controls through every queued settlement", async () => {
    const api = new GroceryApiMock();
    api.inventoryCreateMode = "pending";
    const requests = [1, 2, 3].map((id) =>
      api.fetch("/api/inventory", {
        method: "POST",
        body: JSON.stringify({
          name: `Item ${id}`,
          category: "Pantry",
          quantity: 1,
          unit: "each",
          minThreshold: 0,
        }),
      }),
    );

    assert.equal(api.inventoryCreateBodies.length, 3);
    api.resolvePendingCreate?.();
    api.rejectPendingCreate?.();
    api.resolvePendingCreate?.();

    const results = await Promise.allSettled(requests);
    assert.equal(results[0]?.status, "fulfilled");
    assert.equal(results[1]?.status, "rejected");
    assert.equal(results[2]?.status, "fulfilled");
    assert.equal(api.items.length, 2);
    assert.equal(api.resolvePendingCreate, null);
    assert.equal(api.rejectPendingCreate, null);
  });

  it("rejects stale inventory updates without moving the mock revision backwards", async () => {
    const api = new GroceryApiMock();
    api.items = [dashboardItem(1, "Rice", "Pantry", 4, 1)];
    const staleRevision = api.items[0]!.revision;
    const current = await api.fetch("/api/inventory/1", {
      method: "PATCH",
      body: JSON.stringify({ quantity: 6, revision: staleRevision }),
    });
    assert.equal(current.status, 200);
    assert.equal(api.items[0]!.revision, staleRevision + 1);

    const stale = await api.fetch("/api/inventory/1", {
      method: "PATCH",
      body: JSON.stringify({ quantity: 99, revision: staleRevision }),
    });
    assert.equal(stale.status, 409);
    assert.equal(api.items[0]!.quantity, 6);
    assert.equal(api.items[0]!.revision, staleRevision + 1);
  });

  it("keeps create mode open, preserves category and custom unit, resets the draft, and focuses Name", async () => {
    const api = new GroceryApiMock();
    globalThis.fetch = api.fetch;
    renderApp();

    await screen.findByText("Your pantry is in good shape.");
    await openInventory();
    fireEvent.click(screen.getByTestId("button-add-item"));
    await screen.findByTestId("input-item-name");
    changeInput("input-item-name", "Milk");
    changeInput("input-item-category", "Dairy");
    changeInput("input-item-quantity", "1.5");
    changeInput("input-item-custom-unit", "bottles");
    changeInput("input-item-threshold", "6");
    changeInput("input-item-expires", "2026-12-01");
    changeInput("input-item-notes", "Keep cold");

    fireEvent.click(screen.getByTestId("button-save-and-add-another"));
    await waitFor(() => assert.equal(api.items.length, 1));

    assert.ok(screen.getByTestId("dialog-inventory-item"));
    assert.equal((screen.getByTestId("input-item-name") as HTMLInputElement).value, "");
    assert.equal((screen.getByTestId("input-item-category") as HTMLInputElement).value, "Dairy");
    assert.equal((screen.getByTestId("input-item-custom-unit") as HTMLInputElement).value, "bottles");
    assert.equal((screen.getByTestId("input-item-quantity") as HTMLInputElement).value, "0");
    assert.equal((screen.getByTestId("input-item-threshold") as HTMLInputElement).value, "0");
    assert.equal((screen.getByTestId("input-item-expires") as HTMLInputElement).value, "");
    assert.equal((screen.getByTestId("input-item-notes") as HTMLTextAreaElement).value, "");
    assert.equal(document.activeElement, screen.getByTestId("input-item-name"));

    changeInput("input-item-name", "Yogurt");
    fireEvent.change(screen.getByTestId("input-item-unit"), { target: { value: "pack" } });
    fireEvent.click(screen.getByTestId("button-save-item"));
    await waitFor(() => assert.equal(api.items.length, 2));
    assert.equal(screen.queryByTestId("dialog-inventory-item"), null);
    assert.equal(api.items[1]?.name, "Yogurt");
    assert.equal(api.items[1]?.category, "Dairy");
    assert.equal(api.items[1]?.unit, "pack");

    await openInventory();
    fireEvent.click(screen.getByTestId("button-edit-1"));
    await screen.findByTestId("dialog-inventory-item");
    assert.equal(screen.queryByTestId("button-save-and-add-another"), null);
  });

  it("preserves the draft after a failed save and allows retry", async () => {
    const api = new GroceryApiMock();
    api.inventoryCreateMode = "error";
    globalThis.fetch = api.fetch;
    renderApp();

    await screen.findByText("Your pantry is in good shape.");
    await openInventory();
    fireEvent.click(screen.getByTestId("button-add-item"));
    await screen.findByTestId("input-item-name");
    changeInput("input-item-name", "Rice");
    changeInput("input-item-category", "Pantry");
    changeInput("input-item-custom-unit", "bags");
    changeInput("input-item-quantity", "2");
    changeInput("input-item-threshold", "1");

    fireEvent.click(screen.getByTestId("button-save-and-add-another"));
    await waitFor(() => assert.equal(api.inventoryCreateBodies.length, 1));
    await waitFor(() => assert.equal((screen.getByTestId("button-save-and-add-another") as HTMLButtonElement).disabled, false));
    assert.equal(api.items.length, 0);
    assert.equal((screen.getByTestId("input-item-name") as HTMLInputElement).value, "Rice");
    assert.equal((screen.getByTestId("input-item-category") as HTMLInputElement).value, "Pantry");

    api.inventoryCreateMode = "normal";
    fireEvent.click(screen.getByTestId("button-save-and-add-another"));
    await waitFor(() => assert.equal(api.items.length, 1));
    assert.equal((screen.getByTestId("input-item-name") as HTMLInputElement).value, "");
  });

  it("clears the continue intent when validation fails before switching to Save item", async () => {
    const api = new GroceryApiMock();
    globalThis.fetch = api.fetch;
    renderApp();

    await screen.findByText("Your pantry is in good shape.");
    await openInventory();
    fireEvent.click(screen.getByTestId("button-add-item"));
    await screen.findByTestId("input-item-name");
    changeInput("input-item-category", "Pantry");
    changeInput("input-item-custom-unit", "bags");
    changeInput("input-item-quantity", "2");
    changeInput("input-item-threshold", "1");

    fireEvent.click(screen.getByTestId("button-save-and-add-another"));
    await screen.findByText("Name is required");
    assert.equal(api.items.length, 0);

    changeInput("input-item-name", "Rice");
    screen.getByTestId("dialog-inventory-item").querySelector("form")!.requestSubmit();
    await waitFor(() => assert.equal(api.items.length, 1));
    assert.equal(screen.queryByTestId("dialog-inventory-item"), null);
  });

  it("clears the continue intent when native quantity validation blocks submission", async () => {
    const api = new GroceryApiMock();
    globalThis.fetch = api.fetch;
    renderApp();

    await screen.findByText("Your pantry is in good shape.");
    await openInventory();
    fireEvent.click(screen.getByTestId("button-add-item"));
    await screen.findByTestId("input-item-name");
    changeInput("input-item-name", "Rice");
    changeInput("input-item-category", "Pantry");
    changeInput("input-item-custom-unit", "bags");
    changeInput("input-item-quantity", "2.55");
    changeInput("input-item-threshold", "1");

    const continueButton = screen.getByTestId("button-save-and-add-another");
    let invalidEvents = 0;
    screen.getByTestId("input-item-quantity").addEventListener("invalid", () => {
      invalidEvents += 1;
    }, { once: true });
    (continueButton as HTMLButtonElement).click();
    assert.equal(invalidEvents, 1);
    assert.equal(api.items.length, 0);
    assert.ok(screen.getByTestId("dialog-inventory-item"));

    changeInput("input-item-quantity", "2.5");
    screen.getByTestId("dialog-inventory-item").querySelector("form")!.requestSubmit();
    await waitFor(() => assert.equal(api.items.length, 1));
    assert.equal(screen.queryByTestId("dialog-inventory-item"), null);
  });

  it("preserves the next draft when a dismissed continue save refreshes in the background", async () => {
    const api = new GroceryApiMock();
    api.inventoryCreateMode = "pending";
    globalThis.fetch = api.fetch;
    renderApp();

    await screen.findByText("Your pantry is in good shape.");
    await openInventory();
    fireEvent.click(screen.getByTestId("button-add-item"));
    await screen.findByTestId("input-item-name");
    changeInput("input-item-name", "Old draft");
    changeInput("input-item-category", "Pantry");
    changeInput("input-item-custom-unit", "bags");
    changeInput("input-item-quantity", "2");
    changeInput("input-item-threshold", "1");
    fireEvent.click(screen.getByTestId("button-save-and-add-another"));
    await waitFor(() => assert.equal(api.inventoryCreateBodies.length, 1));

    fireEvent.click(screen.getByTestId("button-cancel"));
    await waitFor(() => assert.equal(screen.queryByTestId("dialog-inventory-item"), null));
    fireEvent.click(screen.getByTestId("button-add-item"));
    await screen.findByTestId("input-item-name");
    changeInput("input-item-name", "New draft");
    changeInput("input-item-category", "Dairy");
    changeInput("input-item-custom-unit", "bottles");
    changeInput("input-item-quantity", "3");
    changeInput("input-item-threshold", "1");
    const focusedInput = screen.getByTestId("input-item-category");
    focusedInput.focus();

    api.resolvePendingCreate?.();
    await waitFor(() => assert.equal(api.items.length, 1));
    assert.ok(screen.getByTestId("dialog-inventory-item"));
    assert.equal((screen.getByTestId("input-item-name") as HTMLInputElement).value, "New draft");
    assert.equal((screen.getByTestId("input-item-category") as HTMLInputElement).value, "Dairy");
    assert.equal((screen.getByTestId("input-item-custom-unit") as HTMLInputElement).value, "bottles");
    assert.equal(document.activeElement, focusedInput);
  });

  it("ignores a dismissed save error while a reopened draft is submitting", async () => {
    const api = new GroceryApiMock();
    api.inventoryCreateMode = "pending";
    globalThis.fetch = api.fetch;
    renderApp();

    await screen.findByText("Your pantry is in good shape.");
    await openInventory();
    fireEvent.click(screen.getByTestId("button-add-item"));
    await screen.findByTestId("input-item-name");
    changeInput("input-item-name", "Old draft");
    changeInput("input-item-category", "Pantry");
    changeInput("input-item-custom-unit", "bags");
    changeInput("input-item-quantity", "2");
    changeInput("input-item-threshold", "1");
    fireEvent.click(screen.getByTestId("button-save-item"));
    await waitFor(() => assert.equal(api.inventoryCreateBodies.length, 1));

    fireEvent.click(screen.getByTestId("button-cancel"));
    await waitFor(() => assert.equal(screen.queryByTestId("dialog-inventory-item"), null));
    fireEvent.click(screen.getByTestId("button-add-item"));
    await screen.findByTestId("input-item-name");
    changeInput("input-item-name", "New draft");
    changeInput("input-item-category", "Dairy");
    changeInput("input-item-custom-unit", "bottles");
    changeInput("input-item-quantity", "3");
    changeInput("input-item-threshold", "1");
    fireEvent.click(screen.getByTestId("button-save-item"));
    await waitFor(() => assert.equal(api.inventoryCreateBodies.length, 2));

    api.rejectPendingCreate?.();
    await waitFor(() => assert.equal((screen.getByTestId("button-save-item") as HTMLButtonElement).disabled, true));
    assert.ok(screen.getByTestId("dialog-inventory-item"));
    assert.equal((screen.getByTestId("input-item-name") as HTMLInputElement).value, "New draft");

    api.resolvePendingCreate?.();
    await waitFor(() => assert.equal(api.items.length, 1));
    assert.equal(screen.queryByTestId("dialog-inventory-item"), null);
  });

  it("prevents overlapping create submissions while pending", async () => {
    const api = new GroceryApiMock();
    api.inventoryCreateMode = "pending";
    globalThis.fetch = api.fetch;
    renderApp();

    await screen.findByText("Your pantry is in good shape.");
    await openInventory();
    fireEvent.click(screen.getByTestId("button-add-item"));
    await screen.findByTestId("input-item-name");
    changeInput("input-item-name", "Beans");
    changeInput("input-item-category", "Pantry");
    changeInput("input-item-custom-unit", "cans");
    changeInput("input-item-quantity", "3");
    changeInput("input-item-threshold", "1");

    fireEvent.click(screen.getByTestId("button-save-and-add-another"));
    await waitFor(() => assert.equal(api.inventoryCreateBodies.length, 1));
    assert.equal((screen.getByTestId("button-save-and-add-another") as HTMLButtonElement).disabled, true);
    for (const testId of [
      "input-item-name",
      "input-item-category",
      "input-item-custom-unit",
      "input-item-quantity",
      "input-item-threshold",
    ]) {
      assert.equal((screen.getByTestId(testId) as HTMLInputElement).disabled, true);
    }
    fireEvent.submit(screen.getByTestId("dialog-inventory-item").querySelector("form")!);
    assert.equal(api.inventoryCreateBodies.length, 1);

    api.resolvePendingCreate?.();
    await waitFor(() => assert.equal(api.items.length, 1));
    assert.ok(screen.getByTestId("dialog-inventory-item"));
  });
});

describe("expired inventory attention", () => {
  it("refreshes dashboard attention at UTC midnight without editing inventory", async (context) => {
    context.mock.timers.enable({ apis: ["Date", "setInterval"], now: new Date("2026-11-08T23:59:50Z") });
    const api = new MockPantryApi();
    api.state.inventory = [dashboardItem(101, "Midnight milk", "Dairy", 5, 2, 0)];
    globalThis.fetch = api.fetch;
    renderApp();
    await waitFor(() => assert.equal(screen.getByTestId("stat-expiring").textContent, "1"));
    assert.equal(screen.getByTestId("stat-expired").textContent, "0");
    await act(async () => { context.mock.timers.tick(30_000); });
    await waitFor(() => assert.equal(screen.getByTestId("stat-expired").textContent, "1"));
    assert.equal(screen.getByTestId("stat-expiring").textContent, "0");
    assert.equal(screen.getByTestId("category-attention-dairy-expired-count").textContent, "1");
  });

  it("shows expired and low alerts, links to the exact item, and clears after correcting its date", async () => {
    const api = new MockPantryApi();
    api.state.inventory = [
      dashboardItem(101, "Expired milk", "Dairy", 1, 2, -1),
      dashboardItem(102, "Future milk", "Dairy", 5, 2, 3),
    ];
    globalThis.fetch = api.fetch;
    renderApp();
    await waitFor(() => assert.equal(screen.getByTestId("stat-expired").textContent, "1"));
    assert.equal(screen.getByTestId("category-attention-dairy-total").textContent, "2");
    assert.equal(screen.getByTestId("category-attention-dairy-expired-count").textContent, "1");
    assert.equal(screen.queryByText("No grocery suggestions right now."), null);
    fireEvent.click(screen.getByTestId("notification-bell"));
    const panel = screen.getByRole("button", { name: "Close notifications" }).parentElement!.parentElement!;
    assert.equal(within(panel).queryByText("All caught up!"), null);
    const alerts = await within(panel).findAllByRole("link", { name: "Expired milk" });
    assert.equal(alerts.length, 1);
    assert.equal(alerts[0].getAttribute("href"), "/inventory?item=101");
    fireEvent.click(alerts[0]);
    await screen.findByRole("heading", { name: "Inventory" });
    await screen.findByTestId("inventory-item-101");
    assert.equal(screen.queryByTestId("inventory-item-102"), null);
    const card = screen.getByTestId("inventory-item-101");
    assert.ok(within(card).getByText("Expired"));
    assert.ok(within(card).getByText("Low Stock"));
    assert.ok(card.textContent?.includes("Expired on:"));
    fireEvent.click(screen.getByTestId("button-edit-101"));
    await screen.findByTestId("dialog-inventory-item");
    changeInput("input-item-expires", "");
    fireEvent.click(screen.getByTestId("button-save-item"));
    await waitFor(() => assert.equal(api.state.inventory[0].expiresAt, null));
    await waitFor(() => assert.equal(within(card).queryByText("Expired"), null));
    fireEvent.click(screen.getByRole("link", { name: "Dashboard" }));
    await waitFor(() => assert.equal(screen.getByTestId("stat-expired").textContent, "0"));
    // Replenishment remains available after freshness attention clears.
    assert.equal((screen.getByTestId("button-generate-shopping-list") as HTMLButtonElement).disabled, false);
  });

  it("shows expiring as primary while retaining low stock on the inventory card", async () => {
    const api = new MockPantryApi();
    api.state.inventory = [dashboardItem(101, "Expiring milk", "Dairy", 1, 2, 3)];
    globalThis.fetch = api.fetch;
    renderApp();
    await waitFor(() => assert.ok(screen.getByText("Expiring milk")));
    fireEvent.click(screen.getByRole("link", { name: "Inventory" }));
    await screen.findByTestId("inventory-item-101");
    const card = screen.getByTestId("inventory-item-101");
    assert.ok(card.className.includes("inventory-item-expiring"));
    assert.ok(within(card).getByText("Expiring Soon"));
    assert.ok(within(card).getByText("Low Stock"));
  });

  it("handles the combined Milk alert across dashboard, notifications, review, and read state", async (context) => {
    context.mock.timers.enable({ apis: ["Date"], now: new Date("2026-11-12T12:00:00Z") });
    const api = new MockPantryApi();
    api.state.inventory = [
      dashboardItem(101, "Milk", "Dairy", 1.5, 1.5, 2),
    ];
    api.state.inventory[0].unit = "litres";
    globalThis.fetch = api.fetch;
    const { queryClient } = renderApp();

    await waitFor(() => assert.equal(screen.getByTestId("stat-low-stock").textContent?.trim(), "1"));
    assert.equal(screen.getByTestId("stat-expiring").textContent?.trim(), "1");
    assert.equal(screen.getByTestId("category-attention-dairy-total").textContent, "1");
    assert.equal(screen.getByTestId("category-attention-dairy-low-count").textContent, "1");
    assert.equal(screen.getByTestId("category-attention-dairy-expiring-count").textContent, "1");

    const bell = screen.getByTestId("notification-bell");
    fireEvent.click(bell);
    const panel = screen.getByTestId("notification-panel");
    assert.equal(within(panel).getAllByRole("link", { name: "Milk" }).length, 1);
    assert.ok(panel.textContent?.includes("Expires on 2026-11-14"));
    assert.ok(panel.textContent?.includes("minimum is 1.5 litres"));
    await waitFor(() => assert.equal(bell.textContent?.includes("1"), false));
    fireEvent.click(within(panel).getByRole("button", { name: "Close notifications" }));

    await queryClient.refetchQueries({ queryKey: getGetGrocerySuggestionsQueryKey() });
    assert.equal(bell.textContent?.includes("1"), false);
    fireEvent.click(screen.getByTestId("button-generate-shopping-list"));
    await screen.findByRole("heading", { name: "Review shopping list" });
    assert.equal(screen.getAllByTestId("preview-item-101").length, 1);
    assert.ok(screen.getByTestId("preview-item-101").textContent?.includes("Expires on 2026-11-14"));
    const quantity = screen.getByLabelText("Milk quantity") as HTMLInputElement;
    fireEvent.change(quantity, { target: { value: "2" } });
    assert.equal(quantity.value, "2");
    fireEvent.click(screen.getByRole("button", { name: "Remove Milk from shopping list review" }));
    assert.equal(screen.queryByTestId("preview-item-101"), null);

    api.state.inventory[0].expiresAt = "2026-11-15";
    await queryClient.refetchQueries({ queryKey: getGetGrocerySuggestionsQueryKey() });
    await waitFor(() => assert.ok(bell.textContent?.includes("1")));
  });

  it("keeps zero-stock upcoming items out of expiry counts and filters", async (context) => {
    context.mock.timers.enable({ apis: ["Date"], now: new Date("2026-11-12T12:00:00Z") });
    const api = new MockPantryApi();
    api.state.inventory = [
      dashboardItem(101, "Empty milk", "Dairy", 0, 2, 2),
      dashboardItem(102, "Fresh milk", "Dairy", 5, 2, 2),
    ];
    globalThis.fetch = api.fetch;
    renderApp();
    await waitFor(() => assert.equal(screen.getByTestId("stat-expiring").textContent?.trim(), "1"));
    fireEvent.click(screen.getByRole("link", { name: "View Expiring Soon in inventory" }));
    await screen.findByTestId("inventory-item-102");
    assert.equal(screen.queryByTestId("inventory-item-101"), null);
    fireEvent.click(screen.getByRole("link", { name: "Dashboard" }));
    await screen.findByTestId("stat-out-of-stock");
    fireEvent.click(screen.getByRole("link", { name: "View Out of Stock in inventory" }));
    await screen.findByTestId("inventory-item-101");
    const card = screen.getByTestId("inventory-item-101");
    assert.ok(within(card).getByText("Out of Stock"));
    assert.equal(within(card).queryByText("Expiring Soon"), null);
  });

  it("filters expired inventory while leaving empty past-dated items as out of stock", async () => {
    const api = new MockPantryApi();
    api.state.inventory = [
      dashboardItem(101, "Expired milk", "Dairy", 5, 2, -1),
      dashboardItem(102, "Empty milk", "Dairy", 0, 2, -1),
      dashboardItem(103, "Today milk", "Dairy", 5, 2, 0),
    ];
    globalThis.fetch = api.fetch;
    renderApp();
    await waitFor(() => assert.equal(screen.getByTestId("stat-expired").textContent, "1"));
    fireEvent.click(screen.getByRole("link", { name: "View Expired in inventory" }));
    await screen.findByTestId("inventory-item-101");
    assert.equal(screen.queryByTestId("inventory-item-102"), null);
    assert.equal(screen.queryByTestId("inventory-item-103"), null);
    assert.equal(screen.getByTestId("filter-expired").getAttribute("aria-pressed"), "true");
    fireEvent.click(screen.getByTestId("button-delete-101"));
    await screen.findByTestId("dialog-delete-confirm");
    fireEvent.click(screen.getByTestId("button-confirm-delete"));
    await screen.findByText("No items match these filters.");
    fireEvent.click(screen.getByRole("link", { name: "Dashboard" }));
    await waitFor(() => assert.equal(screen.getByTestId("stat-expired").textContent, "0"));
  });
});

function changeInput(testId: string, value: string) {
  fireEvent.change(screen.getByTestId(testId), { target: { value } });
}

async function openInventory() {
  fireEvent.click(screen.getByRole("link", { name: "Inventory" }));
  await screen.findByRole("heading", { name: "Inventory" });
}

async function openDashboard() {
  fireEvent.click(screen.getByRole("link", { name: "Dashboard" }));
  await screen.findByRole("heading", { name: "Dashboard" });
}

afterEach(() => {
  cleanup();
  // Clear caches after unmounting: clearing active queries can trigger refetches.
  for (const client of clients) client.clear();
  clients.clear();
  globalThis.fetch = originalFetch;
  window.history.replaceState({}, "", "/");
    mock.restoreAll();
});

describe("public and protected routes", () => {
  for (const [path, heading] of [
    ["/", /Your home\.\s*A little more in order\./],
    ["/login", "Welcome home."],
    ["/signup", "A little more together."],
    ["/dashboard", "Welcome home."],
    ["/inventory", "Welcome home."],
    ["/shopping-lists/12", "Welcome home."],
    ["/unknown/deep/page?from=bookmark", "Welcome home."],
  ] satisfies [string, string | RegExp][]) {
    it(`shows the expected public page for ${path}`, async () => {
      let requests = 0;
      globalThis.fetch = async () => {
        requests++;
        throw new Error("Landing must not request pantry data");
      };
      const location = memoryLocation({ path });
      const queryClient = createQueryClient();
      render(
        <QueryClientProvider client={queryClient}>
          <Router hook={location.hook}>
            <AppRoutes preview />
          </Router>
        </QueryClientProvider>,
      );
      await screen.findByRole("heading", { name: heading });
      assert.equal(screen.queryByRole("heading", { name: "Dashboard" }), null);
      assert.equal(screen.queryByRole("link", { name: "Inventory" }), null);
      assert.equal(requests, 0);
    });
  }

  it("opens the dashboard after the preview and returns to login on a fresh load", async () => {
    mock.method(authFeatures, "mobilePreviewEnabled", () => true);
    const api = new MockPantryApi();
    globalThis.fetch = api.fetch;
    const location = memoryLocation({ path: "/inventory" });
    const queryClient = createQueryClient({
      defaultOptions: { queries: { retry: false } },
    });
    const mount = () =>
      render(
        <QueryClientProvider client={queryClient}>
          <Router hook={location.hook}>
            <AppRoutes preview />
          </Router>
        </QueryClientProvider>,
      );
    const view = mount();

    await screen.findByRole("heading", { name: "Welcome home." });
    fireEvent.change(screen.getByLabelText("Mobile number"), {
      target: { value: "9876543210" },
    });
    fireEvent.click(
      screen.getByRole("button", { name: "Get verification code" }),
    );
    fireEvent.change(await screen.findByLabelText("Verification code"), {
      target: { value: "123456" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Verify & continue" }));

    await screen.findByRole("heading", { name: "Dashboard" });

    assert.equal(screen.getByRole("link", { name: "Step into your home" }).getAttribute("href"), "/inventory");
    await openInventory();

    await openDashboard();

    view.unmount();
    mount();
    await screen.findByRole("heading", { name: "Welcome home." });
  });
});

describe("logout", () => {
  it("clears preview access and blocks navigation back to app screens", async () => {
    globalThis.fetch = new MockPantryApi().fetch;
    const location = memoryLocation({ path: "/login" });
    const queryClient = createQueryClient({
      defaultOptions: { queries: { retry: false } },
    });
    render(
      <QueryClientProvider client={queryClient}>
        <Router hook={location.hook}>
          <AppRoutes preview />
        </Router>
      </QueryClientProvider>,
    );
    await screen.findByRole("heading", { name: "Welcome home." });
    assert.equal(screen.queryByRole("button", { name: /Account menu for/ }), null);
    fireEvent.change(screen.getByLabelText("Email address"), {
      target: { value: "demo@example.com" },
    });
    fireEvent.click(
      screen.getByRole("button", { name: "Get verification code" }),
    );
    fireEvent.change(await screen.findByLabelText("Verification code"), {
      target: { value: "123456" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Verify & continue" }));
    await screen.findByRole("heading", { name: "Dashboard" });
    assert.equal(screen.queryByRole("link", { name: "Sign in" }), null);
    const accountTrigger = screen.getByRole("button", { name: "Account menu for Demo account" });
    fireEvent.keyDown(accountTrigger, { key: "ArrowDown" });
    fireEvent.click(await screen.findByRole("menuitem", { name: "Account details" }));
    const accountDialog = await screen.findByRole("dialog", { name: "Account details" });
    assert.ok(within(accountDialog).getByText("Demo account"));
    assert.ok(within(accountDialog).getByText("This is a demo preview, not a signed-in account."));
    fireEvent.keyDown(accountDialog, { key: "Escape" });
    await waitFor(() => assert.ok(screen.queryByRole("dialog") === null));
    await openInventory();
    fireEvent.keyDown(screen.getByRole("button", { name: /Account menu for/ }), { key: "ArrowDown" });
    fireEvent.click(await screen.findByRole("menuitem", { name: "Log out" }));
    await screen.findByRole("heading", { name: "Welcome home." });
    assert.equal(queryClient.getQueryCache().getAll().length, 0);
    for (const path of ["/dashboard", "/inventory", "/shopping-lists"]) {
      await act(async () => {
        location.navigate(path);
      });
      await screen.findByRole("heading", { name: "Welcome home." });
      assert.equal(screen.queryByRole("button", { name: /Account menu for/ }), null);
    }
  });
});

describe("mobile sign-in and sign-up preview", () => {
  beforeEach(() => { mock.method(authFeatures, "mobilePreviewEnabled", () => true); });
  it("validates mobile and OTP, allows changing the number, and opens the dashboard directly", async () => {
    globalThis.fetch = async () => {
      throw new Error("Auth preview must not make network requests");
    };
    const { queryClient } = renderApp("/login");
    await screen.findByRole("heading", { name: "Welcome home." });
    fireEvent.click(
      screen.getByRole("button", { name: "Get verification code" }),
    );
    await screen.findByText("Enter your mobile number.");
    fireEvent.change(screen.getByLabelText("Mobile number"), {
      target: { value: "123" },
    });
    fireEvent.click(
      screen.getByRole("button", { name: "Get verification code" }),
    );
    await screen.findByText("Enter a 10-digit Indian mobile number.");
    fireEvent.change(screen.getByLabelText("Mobile number"), {
      target: { value: "9876543210" },
    });
    fireEvent.click(
      screen.getByRole("button", { name: "Get verification code" }),
    );
    await screen.findByLabelText("Verification code");
    assert.equal(
      screen
        .getByRole("button", { name: /Resend in/ })
        .hasAttribute("disabled"),
      true,
    );
    fireEvent.change(screen.getByLabelText("Verification code"), {
      target: { value: "654321" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Verify & continue" }));
    await screen.findByText(
      "That code does not match. For this preview, use 123456.",
    );
    fireEvent.click(screen.getByRole("button", { name: "Change number" }));
    assert.equal(
      (screen.getByLabelText("Mobile number") as HTMLInputElement).value,
      "9876543210",
    );
    fireEvent.click(
      screen.getByRole("button", { name: "Get verification code" }),
    );
    assert.equal(
      ((await screen.findByLabelText("Verification code")) as HTMLInputElement)
        .value,
      "",
    );
    fireEvent.change(screen.getByLabelText("Verification code"), {
      target: { value: "123456" },
    });
    globalThis.fetch = new MockPantryApi().fetch;
    fireEvent.click(screen.getByRole("button", { name: "Verify & continue" }));
    await screen.findByRole("heading", { name: "Dashboard" });
    assert.equal(screen.getByRole("link", { name: "Step into your home" }).getAttribute("href"), "/inventory");
    assert.equal(screen.queryByLabelText("Verification code"), null);
    fireEvent.keyDown(screen.getByRole("button", { name: /Account menu for/ }), { key: "ArrowDown" });
    fireEvent.click(await screen.findByRole("menuitem", { name: "Log out" }));
    assert.equal(
      ((await screen.findByLabelText("Mobile number")) as HTMLInputElement).value,
      "",
    );
  });

  it("switches to signup and enables resend after the cooldown", async () => {
    const { queryClient } = renderApp("/login");
    fireEvent.click(screen.getByRole("link", { name: "Create account" }));
    await screen.findByRole("heading", { name: "A little more together." });
    fireEvent.change(screen.getByRole("textbox", { name: "Your name" }), {
      target: { value: "Riya Preview" },
    });
    fireEvent.change(screen.getByLabelText("Mobile number"), {
      target: { value: "9876543210" },
    });
    fireEvent.click(
      screen.getByRole("button", { name: "Get verification code" }),
    );
    await screen.findByLabelText("Verification code");
    const realNow = Date.now;
    const later = realNow() + 31000;
    try {
      Date.now = () => later;
      const resend = await screen.findByRole(
        "button",
        { name: "Resend code" },
        { timeout: 3000 },
      );
      fireEvent.click(resend);
      await screen.findByText(
        "A fresh demo code is ready: 123456. No SMS was sent.",
      );
      assert.ok(
        screen
          .getByRole("button", { name: /Resend in/ })
          .hasAttribute("disabled"),
      );
    } finally {
      Date.now = realNow;
    }
  });
});

describe("create account name", () => {
  it("requires a nonblank name only for signup and clears it when switching pages", async () => {
    globalThis.fetch = async () => {
      throw new Error("Account preview must not transmit names");
    };
    const { queryClient } = renderApp("/signup");
    await screen.findByRole("textbox", { name: "Your name" });
    fireEvent.change(screen.getByLabelText("Email address"), {
      target: { value: "demo@example.com" },
    });
    fireEvent.click(
      screen.getByRole("button", { name: "Get verification code" }),
    );
    await screen.findByText("Enter your name.");
    assert.equal(document.activeElement, screen.getByRole("textbox", { name: "Your name" }));
    assert.equal(screen.queryByLabelText("Verification code"), null);
    fireEvent.change(screen.getByRole("textbox", { name: "Your name" }), {
      target: { value: "   " },
    });
    fireEvent.click(
      screen.getByRole("button", { name: "Get verification code" }),
    );
    await screen.findByText("Enter your name.");
    fireEvent.change(screen.getByRole("textbox", { name: "Your name" }), {
      target: { value: "Riya Preview" },
    });
    fireEvent.click(
      screen.getByRole("button", { name: "Get verification code" }),
    );
    await screen.findByLabelText("Verification code");
    assert.equal(screen.queryByText("Riya Preview"), null);
    fireEvent.click(screen.getByRole("button", { name: "Change email" }));
    assert.equal(
      (screen.getByRole("textbox", { name: "Your name" }) as HTMLInputElement).value,
      "Riya Preview",
    );
    fireEvent.click(screen.getByRole("link", { name: "Sign in" }));
    assert.equal(screen.queryByRole("textbox", { name: "Your name" }), null);
    fireEvent.click(screen.getByRole("link", { name: "Create account" }));
    assert.equal(
      (screen.getByRole("textbox", { name: "Your name" }) as HTMLInputElement).value,
      "",
    );
  });
});

describe("email OTP preview", () => {
  // This suite also checks switching away from email in the preserved preview.
  beforeEach(() => { mock.method(authFeatures, "mobilePreviewEnabled", () => true); });
  for (const signup of [false, true]) {
    it(`validates email, preserves it on change, expires/resends OTP, and opens dashboard for ${signup ? "signup" : "login"}`, async () => {
      const api = new MockPantryApi();
      let allowDashboard = false;
      globalThis.fetch = async (input, init) => {
        assert.ok(allowDashboard, "OTP preview must not send network requests");
        return api.fetch(input, init);
      };
      const location = memoryLocation({ path: "/login" });
      const queryClient = createQueryClient({
        defaultOptions: { queries: { retry: false } },
      });
      render(
        <QueryClientProvider client={queryClient}>
          <Router hook={location.hook}>
            <AppRoutes preview />
          </Router>
        </QueryClientProvider>,
      );
      await screen.findByRole("heading", { name: "Welcome home." });
      if (signup) {
        fireEvent.click(screen.getByRole("link", { name: "Create account" }));
        fireEvent.change(screen.getByRole("textbox", { name: "Your name" }), {
          target: { value: "Riya Preview" },
        });
      }
      fireEvent.click(screen.getByRole("button", { name: "Email address" }));
      const emailInput = screen.getByLabelText(
        "Email address",
      ) as HTMLInputElement;
      assert.equal(emailInput.type, "email");
      assert.equal(screen.queryByText("+91"), null);
      fireEvent.click(
        screen.getByRole("button", { name: "Get verification code" }),
      );
      await screen.findByText("Enter your email address.");
      fireEvent.change(emailInput, { target: { value: "invalid" } });
      fireEvent.click(
        screen.getByRole("button", { name: "Get verification code" }),
      );
      await screen.findByText(
        "Enter a valid email address, such as you@example.com.",
      );
      fireEvent.change(emailInput, { target: { value: "you@example.com" } });
      fireEvent.click(
        screen.getByRole("button", { name: "Get verification code" }),
      );
      await screen.findByText("Confirm your email address to continue.");
      fireEvent.click(screen.getByRole("button", { name: "Change email" }));
      assert.equal(
        (screen.getByLabelText("Email address") as HTMLInputElement).value,
        "you@example.com",
      );
      fireEvent.click(screen.getByRole("button", { name: "Mobile number" }));
      assert.equal(
        (screen.getByLabelText("Mobile number") as HTMLInputElement).value,
        "",
      );
      fireEvent.click(screen.getByRole("button", { name: "Email address" }));
      fireEvent.change(screen.getByLabelText("Email address"), {
        target: { value: "you@example.com" },
      });
      fireEvent.click(
        screen.getByRole("button", { name: "Get verification code" }),
      );
      const realNow = Date.now;
      const later = realNow() + 301000;
      try {
        Date.now = () => later;
        fireEvent.change(screen.getByLabelText("Verification code"), {
          target: { value: "123456" },
        });
        fireEvent.click(
          screen.getByRole("button", { name: "Verify & continue" }),
        );
        await screen.findByText(
          "This demo code has expired. Request another code.",
        );
        fireEvent.click(
          await screen.findByRole(
            "button",
            { name: "Resend code" },
            { timeout: 3000 },
          ),
        );
        await screen.findByText(
          "A fresh demo code is ready: 123456. No email was sent.",
        );
        assert.equal(
          (screen.getByLabelText("Verification code") as HTMLInputElement)
            .value,
          "",
        );
        fireEvent.change(screen.getByLabelText("Verification code"), {
          target: { value: "654321" },
        });
        fireEvent.click(
          screen.getByRole("button", { name: "Verify & continue" }),
        );
        await screen.findByText(
          "That code does not match. For this preview, use 123456.",
        );
        fireEvent.change(screen.getByLabelText("Verification code"), {
          target: { value: "123456" },
        });
        allowDashboard = true;
        fireEvent.click(
          screen.getByRole("button", { name: "Verify & continue" }),
        );
        await screen.findByRole("heading", { name: "Dashboard" });
        assert.equal(screen.getByRole("link", { name: "Step into your home" }).getAttribute("href"), "/inventory");
        assert.equal(screen.queryByText("you@example.com"), null);
        assert.equal(screen.queryByText("Riya Preview"), null);
        assert.equal(screen.queryByRole("textbox", { name: "Your name" }), null);
        if (signup) {
          await openInventory();
          assert.equal(screen.queryByText("Riya Preview"), null);
          fireEvent.keyDown(screen.getByRole("button", { name: /Account menu for/ }), { key: "ArrowDown" });
          fireEvent.click(await screen.findByRole("menuitem", { name: "Log out" }));
          await screen.findByRole("heading", { name: "Welcome home." });
          fireEvent.click(screen.getByRole("link", { name: "Create account" }));
          assert.equal(
            (screen.getByRole("textbox", { name: "Your name" }) as HTMLInputElement).value,
            "",
          );
        }
      } finally {
        Date.now = realNow;
      }
    });
  }
});

describe("shopping list selection and deletion", () => {
  async function setup() {
    const api = new MockPantryApi();
    api.state.lists.push({
      ...api.state.lists[0],
      id: 30,
      name: "Party supplies",
      items: [],
    });
    globalThis.fetch = api.fetch;
    const app = renderApp();
    fireEvent.click(screen.getByRole("link", { name: "Shopping Lists" }));
    await screen.findByRole("checkbox", { name: "Select Weekend groceries" });
    return { api, ...app };
  }

  it("marks the active navigation and returns from list details through breadcrumbs", async () => {
    const { queryClient } = await setup();
    const mainNav = screen.getByRole("navigation", { name: "Main navigation" });
    const breadcrumb = screen.getByRole("navigation", { name: "Breadcrumb" });
    assert.equal(
      within(mainNav).getByRole("link", { name: "Shopping Lists" }).getAttribute("aria-current"),
      "page",
    );
    assert.equal(
      within(breadcrumb).getByRole("link", { name: "Shopping Lists" }).getAttribute("aria-current"),
      "page",
    );

    fireEvent.click(screen.getByRole("link", { name: "Weekend groceries" }));
    await screen.findByRole("checkbox", { name: "Purchased Milk" });
    const detailBreadcrumb = screen.getByRole("navigation", { name: "Breadcrumb" });
    assert.equal(
      within(detailBreadcrumb).getByText("List details").getAttribute("aria-current"),
      "page",
    );
    fireEvent.click(within(detailBreadcrumb).getByRole("link", { name: "Shopping Lists" }));
    await screen.findByRole("checkbox", { name: "Select Weekend groceries" });
  });

  it("shows progress and clearly labels the sample comparison while preserving detail links", async () => {
    const { queryClient } = await setup();
    assert.ok(
      screen
        .getByRole("link", { name: "Weekend groceries" })
        .getAttribute("href")
        ?.endsWith("/shopping-lists/20"),
    );
    assert.match(
      screen.getByTestId("shopping-list-20").textContent ?? "",
      /items purchased/,
    );
    assert.match(
      screen.getByRole("button", { name: "Compare prices (sample)" }).textContent ?? "",
      /sample/,
    );
    assert.ok(screen.getByTestId("shopping-list-20"));
    fireEvent.click(screen.getByRole("link", { name: "Weekend groceries" }));
    assert.ok(await screen.findByRole("checkbox", { name: "Purchased Milk" }));
    assert.ok(screen.getByRole("button", { name: "Remove Milk from Weekend groceries" }));
    assert.ok(screen.getByRole("progressbar", { name: "Weekend groceries: 0% complete" }));
  });

  it("preserves newer item state while a rename is pending", async () => {
    const { api, queryClient } = await setup();
    const itemCount = api.state.lists[0].items.length;
    fireEvent.click(screen.getByRole("link", { name: "Weekend groceries" }));
    await screen.findByRole("checkbox", { name: "Purchased Milk" });
    fireEvent.click(screen.getByRole("button", { name: "Edit name for Weekend groceries" }));
    const input = await screen.findByRole("textbox", { name: "List name" });
    assert.equal((input as HTMLInputElement).value, "Weekend groceries");
    fireEvent.change(input, { target: { value: String.fromCodePoint(0x1f600).repeat(101) } });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    assert.ok(await screen.findByRole("alert"));
    assert.equal(api.state.lists[0].name, "Weekend groceries");
    fireEvent.change(input, { target: { value: "\ufeffRenamed\u00a0 list\u3000" } });

    const detailQueryKey = getGetShoppingListQueryKey(api.state.lists[0].id);
    const originalFetch = api.fetch;
    let releaseRename!: () => void;
    const renameReleased = new Promise<void>((resolve) => {
      releaseRename = resolve;
    });
    let renameStarted = false;
    globalThis.fetch = async (request, init) => {
      if (String(request) === `/api/shopping-lists/${api.state.lists[0].id}` && init?.method === "PATCH") {
        renameStarted = true;
        const response = await originalFetch(request, init);
        const staleResponseBody = await response.text();
        await renameReleased;
        return new Response(staleResponseBody, {
          status: response.status,
          headers: { "Content-Type": "application/json" },
        });
      }
      return originalFetch(request, init);
    };

    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() => assert.equal(renameStarted, true));

    api.state.lists[0].items[0].quantity = 9;
    api.state.lists[0].items[0].purchased = true;
    await act(async () => {
      queryClient.setQueryData<ShoppingListWithItems>(detailQueryKey, {
        ...queryClient.getQueryData<ShoppingListWithItems>(detailQueryKey)!,
        items: api.state.lists[0].items.map((item) => ({ ...item })),
      });
    });
    releaseRename();

    await screen.findByRole("heading", { name: "Renamed list" });
    assert.equal(
      (screen.getByRole("spinbutton", { name: "Milk quantity" }) as HTMLInputElement).value,
      "9",
    );
    assert.equal(
      screen.getByRole("checkbox", { name: "Purchased Milk" }).getAttribute("data-state"),
      "checked",
    );
    assert.equal(api.state.lists[0].name, "Renamed\u00a0 list");
    assert.equal(api.state.lists[0].items.length, itemCount);
  });

  it("does not let a unit-and-notes edit overwrite a newer inline quantity save", async () => {
    const { api } = await setup();
    fireEvent.click(screen.getByRole("link", { name: "Weekend groceries" }));
    await screen.findByRole("checkbox", { name: "Purchased Milk" });

    const originalFetch = api.fetch;
    let releaseQuantity!: () => void;
    const quantityReleased = new Promise<void>((resolve) => { releaseQuantity = resolve; });
    let quantityStarted = false;
    const bodies: Record<string, unknown>[] = [];
    globalThis.fetch = async (input, init) => {
      if (String(input) === "/api/shopping-lists/20/items/21" && init?.method === "PATCH") {
        const body = JSON.parse(String(init.body)) as Record<string, unknown>;
        bodies.push(body);
        if (body.quantity === 9) {
          quantityStarted = true;
          await quantityReleased;
        }
      }
      return originalFetch(input, init);
    };

    const quantity = screen.getByRole("spinbutton", { name: "Milk quantity" });
    fireEvent.change(quantity, { target: { value: "9" } });
    fireEvent.blur(quantity);
    await waitFor(() => assert.equal(quantityStarted, true));

    fireEvent.click(screen.getByRole("button", { name: "Edit Milk" }));
    await screen.findByTestId("dialog-edit-shopping-item");
    fireEvent.change(screen.getByTestId("input-shopping-item-notes"), { target: { value: "Updated note" } });
    releaseQuantity();
    fireEvent.click(screen.getByTestId("button-add-shopping-item"));

    await waitFor(() => assert.equal(api.state.lists[0].items[0].quantity, 9));
    await waitFor(() => assert.equal(api.state.lists[0].items[0].notes, "Updated note"));
    assert.equal(bodies[1]?.quantity, undefined);
    assert.equal((screen.getByRole("spinbutton", { name: "Milk quantity" }) as HTMLInputElement).value, "9");
  });

  it("prefills linked units, switches preset/custom modes, and validates custom units", async () => {
    const { api } = await setup();
    fireEvent.click(screen.getByRole("link", { name: "Weekend groceries" }));
    await screen.findByRole("checkbox", { name: "Purchased Milk" });

    fireEvent.click(screen.getByRole("button", { name: "Edit Milk" }));
    await screen.findByTestId("dialog-edit-shopping-item");
    assert.equal((screen.getByTestId("input-shopping-item-unit") as HTMLSelectElement).value, "Custom");
    assert.equal((screen.getByTestId("input-shopping-item-custom-unit") as HTMLInputElement).value, "litres");
    assert.equal((screen.getByTestId("input-shopping-item-unit") as HTMLSelectElement).disabled, true);
    fireEvent.click(screen.getByTestId("button-cancel"));

    fireEvent.click(screen.getByTestId("button-add-item"));
    await screen.findByTestId("dialog-add-shopping-item");
    fireEvent.change(screen.getByTestId("input-shopping-item-name"), { target: { value: "Custom item" } });
    fireEvent.change(screen.getByTestId("input-shopping-item-category"), { target: { value: "Pantry" } });
    fireEvent.change(screen.getByTestId("input-shopping-item-unit"), { target: { value: "kg" } });
    assert.equal((screen.getByTestId("input-shopping-item-unit") as HTMLSelectElement).value, "kg");
    fireEvent.change(screen.getByTestId("input-shopping-item-unit"), { target: { value: "Custom" } });
    fireEvent.change(screen.getByTestId("input-shopping-item-custom-unit"), { target: { value: "2.5" } });
    fireEvent.click(screen.getByTestId("button-add-shopping-item"));
    await screen.findByText("Choose a unit or enter a custom text unit");
    assert.equal(api.state.lists[0].items.length, 2);

    fireEvent.change(screen.getByTestId("input-shopping-item-custom-unit"), { target: { value: "grams" } });
    fireEvent.click(screen.getByTestId("button-add-shopping-item"));
    await waitFor(() => assert.equal(api.state.lists[0].items.length, 3));
    assert.equal(api.state.lists[0].items[2].unit, "grams");
  });

  it("keeps an individually failed deletion selected for bulk retry", async () => {
    const { api, queryClient } = await setup();
    globalThis.fetch = async (input, init) => {
      if (
        String(input) === "/api/shopping-lists/30" &&
        init?.method === "DELETE"
      ) {
        return new Response('{"error":"Try again"}', {
          status: 500,
          headers: { "Content-Type": "application/json" },
        });
      }
      return api.fetch(input, init);
    };
    fireEvent.click(
      screen.getByRole("button", { name: "Delete Party supplies" }),
    );
    fireEvent.click(await screen.findByTestId("button-confirm-delete"));
    await screen.findByRole("button", { name: "Delete selected (1)" });
    assert.equal(
      screen
        .getByRole("checkbox", { name: "Select Party supplies" })
        .getAttribute("aria-checked"),
      "true",
    );
  });

  it("does not restore deleted IDs when the later list refresh fails", async () => {
    const { api, queryClient } = await setup();
    const replacement = { ...api.state.lists[0], name: "Replacement list" };
    let failRefresh = true;
    globalThis.fetch = (input, init) => {
      if (
        String(input) === "/api/shopping-lists" &&
        (init?.method ?? "GET") === "GET" &&
        failRefresh
      ) {
        return Promise.resolve(
          new Response('{"error":"Refresh unavailable"}', {
            status: 500,
            headers: { "Content-Type": "application/json" },
          }),
        );
      }
      return api.fetch(input, init);
    };
    function ToastTitles() {
      const { toasts } = useToast();
      return <div>{toasts.map((toast) => <span key={toast.id}>{toast.title}</span>)}</div>;
    }
    render(<ToastTitles />);
    fireEvent.click(
      screen.getByRole("checkbox", { name: "Select all shopping lists" }),
    );
    fireEvent.click(screen.getByRole("button", { name: "Delete selected (2)" }));
    fireEvent.click(await screen.findByTestId("button-confirm-delete"));
    await screen.findByText("Could not refresh shopping lists");
    assert.equal(api.state.lists.length, 0);
    failRefresh = false;
    api.state.lists.push(replacement);
    await queryClient.invalidateQueries({ queryKey: getListShoppingListsQueryKey() });
    await screen.findByRole("checkbox", { name: "Select Replacement list" });
    assert.equal(
      screen.getByRole("checkbox", { name: "Select Replacement list" }).getAttribute("aria-checked"),
      "false",
    );
  });

  it("offers a retry when shopping lists fail to load", async () => {
    const api = new MockPantryApi();
    let fail = true;
    globalThis.fetch = (input, init) => {
      if (
        String(input) === "/api/shopping-lists" &&
        (init?.method ?? "GET") === "GET" &&
        fail
      ) {
        return Promise.resolve(
          new Response('{"error":"Unavailable"}', {
            status: 500,
            headers: { "Content-Type": "application/json" },
          }),
        );
      }
      return api.fetch(input, init);
    };
    const { queryClient } = renderApp("/shopping-lists");
    await screen.findByText("Could not load your lists");
    fail = false;
    fireEvent.click(screen.getByRole("button", { name: "Try again" }));
    await screen.findByRole("checkbox", { name: "Select Weekend groceries" });
  });

  it("selects lists without navigating, cancels, then deletes all while preserving inventory", async () => {
    const { api, queryClient } = await setup();
    const inventory = structuredClone(api.state.inventory);
    assert.equal(
      screen.queryByRole("button", { name: /Delete selected/ }),
      null,
    );
    fireEvent.click(
      screen.getByRole("checkbox", { name: "Select Weekend groceries" }),
    );
    assert.ok(screen.getByRole("heading", { name: "Shopping Lists" }));
    assert.equal(
      screen
        .getByRole("checkbox", { name: "Select all shopping lists" })
        .getAttribute("aria-checked"),
      "mixed",
    );
    fireEvent.click(
      screen.getByRole("button", { name: "Delete selected (1)" }),
    );
    await screen.findByRole("alertdialog");
    fireEvent.click(screen.getByTestId("button-cancel-delete"));
    assert.equal(api.state.lists.length, 2);
    fireEvent.click(
      screen.getByRole("checkbox", { name: "Select all shopping lists" }),
    );
    fireEvent.click(
      screen.getByRole("button", { name: "Delete selected (2)" }),
    );
    await screen.findByRole("heading", { name: "Delete 2 Shopping Lists?" });
    fireEvent.click(screen.getByTestId("button-confirm-delete"));
    await screen.findByText("No shopping lists yet.");
    assert.equal(api.state.lists.length, 0);
    assert.deepEqual(api.state.inventory, inventory);
    assert.equal(
      screen.queryByRole("button", { name: /Delete selected/ }),
      null,
    );
  });

  it("keeps failed lists selected and allows retry; individual deletion still works", async () => {
    const { api, queryClient } = await setup();
    globalThis.fetch = async (input, init) => {
      if (
        String(input) === "/api/shopping-lists/30" &&
        init?.method === "DELETE"
      ) {
        return new Response('{"error":"Try again"}', {
          status: 500,
          headers: { "Content-Type": "application/json" },
        });
      }
      return api.fetch(input, init);
    };
    fireEvent.click(
      screen.getByRole("checkbox", { name: "Select all shopping lists" }),
    );
    fireEvent.click(
      screen.getByRole("button", { name: "Delete selected (2)" }),
    );
    fireEvent.click(await screen.findByTestId("button-confirm-delete"));
    await waitFor(() =>
      assert.ok(!screen.queryByTestId("dialog-delete-list-confirm")),
    );
    await screen.findByRole("button", { name: "Delete selected (1)" });
    assert.deepEqual(
      api.state.lists.map((list) => list.id),
      [30],
    );
    assert.equal(
      screen
        .getByRole("checkbox", { name: "Select Party supplies" })
        .getAttribute("aria-checked"),
      "true",
    );
    globalThis.fetch = api.fetch;
    fireEvent.click(
      screen.getByRole("button", { name: "Delete Party supplies" }),
    );
    fireEvent.click(await screen.findByTestId("button-confirm-delete"));
    await screen.findByText("No shopping lists yet.");
  });
});

describe("dashboard inventory attention refresh", () => {
  it("shows every dashboard pantry count from the inventory stats response", async () => {
    const api = new GroceryApiMock();
    const expiringDate = new Date(Date.now() + 3 * 24 * 60 * 60 * 1000)
      .toISOString()
      .slice(0, 10);
    api.items = [
      {
        id: 1,
        name: "Out of stock item",
        category: "Pantry",
        quantity: 0,
        unit: "bags",
        minThreshold: 1,
        expiresAt: null,
        notes: null,
        revision: 0,
        createdAt: timestamp,
        updatedAt: timestamp,
      },
      {
        id: 2,
        name: "Low stock item",
        category: "Produce",
        quantity: 1,
        unit: "units",
        minThreshold: 2,
        expiresAt: null,
        notes: null,
        revision: 0,
        createdAt: timestamp,
        updatedAt: timestamp,
      },
      {
        id: 3,
        name: "Expiring item",
        category: "Dairy",
        quantity: 8,
        unit: "cartons",
        minThreshold: 2,
        expiresAt: expiringDate,
        notes: null,
        revision: 0,
        createdAt: timestamp,
        updatedAt: timestamp,
      },
      {
        id: 4,
        name: "Healthy item",
        category: "Bakery",
        quantity: 5,
        unit: "loaves",
        minThreshold: 2,
        expiresAt: null,
        notes: null,
        revision: 0,
        createdAt: timestamp,
        updatedAt: timestamp,
      },
    ];
    globalThis.fetch = api.fetch;
    renderApp();

    assert.equal(
      (await screen.findByTestId("stat-total-items")).textContent?.trim(),
      "4",
    );
    assert.equal(screen.getByTestId("stat-low-stock").textContent?.trim(), "1");
    assert.equal(
      screen.getByTestId("stat-out-of-stock").textContent?.trim(),
      "1",
    );
    assert.equal(screen.getByTestId("stat-expiring").textContent?.trim(), "1");

    assert.ok(
      (
        await screen.findByTestId("category-attention-pantry")
      ).textContent?.includes("1Out"),
    );
    assert.ok(
      screen
        .getByTestId("category-attention-produce")
        .textContent?.includes("1Low"),
    );
    assert.ok(
      screen
        .getByTestId("category-attention-dairy")
        .textContent?.includes("1Expiring"),
    );
  });

  it("renders exact attention totals and Out, Low, and Expiring counts per category", async () => {
    const api = new GroceryApiMock();
    api.items = [
      dashboardItem(1, "Carrots", "Produce", 0, 2, 1),
      dashboardItem(2, "Onions", "Produce", 1, 2, 2),
      dashboardItem(3, "Pears", "Produce", 5, 2, 3),
      dashboardItem(4, "Milk", "Dairy", 1, 2, 2),
      dashboardItem(5, "Yogurt", "Dairy", 4, 1),
      dashboardItem(6, "Bread", "Bakery", 5, 1, 5),
      dashboardItem(7, "Beans", "Canned Goods", 8, 2),
    ];
    globalThis.fetch = api.fetch;
    const { queryClient } = renderApp();

    const expected = [
      { category: "produce", attention: 3, out: 1, low: 1, expiring: 2 },
      { category: "dairy", attention: 1, out: 0, low: 1, expiring: 1 },
      { category: "bakery", attention: 1, out: 0, low: 0, expiring: 1 },
    ];

    for (const counts of expected) {
      const categoryId = `category-attention-${counts.category}`;
      await screen.findByTestId(categoryId);
      assert.equal(
        screen.getByTestId(`${categoryId}-total`).textContent,
        String(counts.attention),
      );
      assert.equal(
        screen.getByTestId(`${categoryId}-out-count`).textContent,
        String(counts.out),
      );
      assert.equal(
        screen.getByTestId(`${categoryId}-low-count`).textContent,
        String(counts.low),
      );
      assert.equal(
        screen.getByTestId(`${categoryId}-expiring-count`).textContent,
        String(counts.expiring),
      );
    }

    assert.equal(screen.queryByTestId("category-attention-canned-goods"), null);
    assert.equal(screen.queryByText("Your pantry is in good shape."), null);
  });

  it("shows the good-shape message and no cards for healthy-only categories", async () => {
    const api = new GroceryApiMock();
    api.items = [
      dashboardItem(1, "Rice", "Pantry", 5, 1),
      dashboardItem(2, "Cereal", "Breakfast", 4, 1, 10),
    ];
    globalThis.fetch = api.fetch;
    const { queryClient } = renderApp();

    await screen.findByText("Your pantry is in good shape.");
    assert.equal(screen.queryByTestId("category-attention-pantry"), null);
    assert.equal(screen.queryByTestId("category-attention-breakfast"), null);
  });

  it("generates a linked shopping list from low-stock suggestions and restocks it", async () => {
    const api = new GroceryApiMock();
    api.items = [
      dashboardItem(1, "Rice", "Pantry", 0, 2),
      dashboardItem(2, "Apples", "Produce", 1, 3),
      dashboardItem(3, "Milk", "Dairy", 5, 2, 2),
    ];
    globalThis.fetch = api.fetch;
    const { queryClient } = renderApp();

    const generateButton = await screen.findByTestId(
      "button-generate-shopping-list",
    );
    await waitFor(() =>
      assert.equal((generateButton as HTMLButtonElement).disabled, false),
    );
    fireEvent.click(generateButton);

    await screen.findByRole("heading", { name: "Review shopping list" });
    fireEvent.click(
      screen.getByRole("button", { name: "Create shopping list" }),
    );
    await screen.findByRole("heading", { name: "Low-stock shopping list" });
    assert.ok(
      screen.getByTestId("shopping-item-2").textContent?.includes("Rice"),
    );
    assert.ok(
      screen.getByTestId("shopping-item-3").textContent?.includes("Apples"),
    );
    assert.equal(screen.queryByText("Milk"), null);

    fireEvent.click(screen.getByTestId("checkbox-purchased-2"));
    fireEvent.click(screen.getByTestId("button-complete-purchase"));
    await waitFor(() => assert.equal(api.items[0]?.quantity, 2));
    assert.equal(api.items[1]?.quantity, 1);
  });

  it("deduplicates the legacy expired-and-low response before shopping review and submission", async () => {
    const api = new GroceryApiMock();
    api.items = [dashboardItem(1, "Milk", "Dairy", 1, 2, -1)];
    let generatedBody: { items: { inventoryItemId: number; quantity: number }[] } | undefined;
    const legacySuggestions = [
      {
        inventoryItemId: 1,
        name: "Milk",
        category: "Dairy",
        currentQuantity: 1,
        minThreshold: 2,
        unit: "each",
        reason: "Expired on 2026-11-11",
        urgency: "expired",
      },
      {
        inventoryItemId: 1,
        name: "Milk",
        category: "Dairy",
        currentQuantity: 1,
        minThreshold: 2,
        unit: "each",
        reason: "1 each left (minimum is 2 each)",
        urgency: "low",
      },
    ];
    const originalFetch = api.fetch;
    globalThis.fetch = async (input, init) => {
      const url = new URL(typeof input === "string" ? input : input.toString(), "http://localhost");
      if (url.pathname === "/api/suggestions" && (init?.method ?? "GET") === "GET") {
        return new Response(JSON.stringify(legacySuggestions), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        });
      }
      if (url.pathname === "/api/suggestions/generate-list") {
        generatedBody = JSON.parse(String(init?.body));
      }
      return originalFetch(input, init);
    };
    renderApp();
    const generateButton = await screen.findByTestId(
      "button-generate-shopping-list",
    );
    await waitFor(() =>
      assert.equal((generateButton as HTMLButtonElement).disabled, false),
    );
    fireEvent.click(generateButton);
    await screen.findByRole("heading", { name: "Review shopping list" });
    assert.equal(screen.getAllByTestId("preview-item-1").length, 1);
    fireEvent.click(screen.getByRole("button", { name: "Create shopping list" }));
    await screen.findByRole("heading", { name: "Low-stock shopping list" });
    assert.equal(generatedBody?.items.length, 1);
    assert.equal(generatedBody?.items[0]?.inventoryItemId, 1);
  });

  it("hides cached category cards while inventory is being refreshed", async () => {
    const api = new GroceryApiMock();
    api.items = [dashboardItem(1, "Apples", "Produce", 0, 2)];
    globalThis.fetch = api.fetch;
    const { queryClient } = renderApp();

    const categoryId = "category-attention-produce";
    await screen.findByTestId(categoryId);

    api.inventoryGetMode = "pending";
    const refresh = queryClient.refetchQueries({
      queryKey: getListInventoryItemsQueryKey(),
      type: "active",
    });
    await screen.findByTestId("pantry-attention-loading");
    assert.equal(screen.queryByTestId(categoryId), null);

    await queryClient.cancelQueries({
      queryKey: getListInventoryItemsQueryKey(),
    });
    await refresh;
  });

  it("hides cached category cards when inventory refresh fails", async () => {
    const api = new GroceryApiMock();
    api.items = [dashboardItem(1, "Apples", "Produce", 0, 2)];
    globalThis.fetch = api.fetch;
    const { queryClient } = renderApp();

    const categoryId = "category-attention-produce";
    await screen.findByTestId(categoryId);
    api.inventoryGetMode = "error";

    await queryClient.refetchQueries({
      queryKey: getListInventoryItemsQueryKey(),
      type: "active",
    });

    assert.ok(queryClient.getQueryData(getListInventoryItemsQueryKey()));
    await screen.findByRole("alert");
    assert.equal(screen.queryByTestId(categoryId), null);
    assert.equal(
      screen.getByText("Pantry attention could not be loaded.").textContent,
      "Pantry attention could not be loaded.",
    );
  });

  it("refreshes category counts after create, edit, shopping-list restock, and delete flows", async () => {
    const api = new GroceryApiMock();
    globalThis.fetch = api.fetch;
    const { queryClient } = renderApp();

    await screen.findByText("Your pantry is in good shape.");

    await openInventory();
    fireEvent.click(screen.getByTestId("button-add-item"));
    await screen.findByTestId("input-item-name");
    changeInput("input-item-name", "Rice");
    changeInput("input-item-category", "Grains");
    changeInput("input-item-quantity", "1");
    changeInput("input-item-unit", "Custom");
    changeInput("input-item-custom-unit", "bags");
    changeInput("input-item-threshold", "2");
    fireEvent.click(screen.getByTestId("button-save-item"));

    await waitFor(() => assert.equal(api.items.length, 1));
    await openDashboard();
    const grainsAttention = await screen.findByTestId(
      "category-attention-grains",
    );
    assert.ok(grainsAttention.textContent?.includes("1Low"));
    assert.equal(
      screen.getByTestId("stat-total-items").textContent?.includes("1"),
      true,
    );

    await openInventory();
    fireEvent.click(screen.getByTestId("button-edit-1"));
    await screen.findByTestId("dialog-inventory-item");
    assert.equal(
      (screen.getByTestId("input-item-name") as HTMLInputElement).value,
      "Rice",
    );
    changeInput("input-item-category", "Pantry");
    changeInput("input-item-quantity", "0");
    fireEvent.click(screen.getByTestId("button-save-item"));
    await waitFor(() => {
      assert.equal(api.items[0]?.category, "Pantry");
      assert.equal(api.items[0]?.quantity, 0);
    });

    await openDashboard();
    assert.equal(screen.queryByTestId("category-attention-grains"), null);
    const pantryOut = await screen.findByTestId("category-attention-pantry");
    assert.ok(pantryOut.textContent?.includes("1Out"));
    assert.equal(
      screen.getByTestId("stat-out-of-stock").textContent?.includes("1"),
      true,
    );

    await openInventory();
    fireEvent.click(screen.getByTestId("button-edit-1"));
    await screen.findByTestId("dialog-inventory-item");
    changeInput("input-item-quantity", "4");
    fireEvent.click(screen.getByTestId("button-save-item"));
    await waitFor(() => assert.equal(api.items[0]?.quantity, 4));
    await openDashboard();
    await screen.findByText("Your pantry is in good shape.");
    assert.equal(screen.queryByTestId("category-attention-pantry"), null);

    await openInventory();
    fireEvent.click(screen.getByTestId("button-edit-1"));
    await screen.findByTestId("dialog-inventory-item");
    changeInput("input-item-quantity", "0");
    fireEvent.click(screen.getByTestId("button-save-item"));
    await waitFor(() => assert.equal(api.items[0]?.quantity, 0));

    fireEvent.click(screen.getByRole("link", { name: "Shopping Lists" }));
    await screen.findByRole("heading", { name: "Shopping Lists" });
    fireEvent.click(await screen.findByRole("link", { name: /Weekly shop/ }));
    await screen.findByRole("heading", { name: "Weekly shop" });
    fireEvent.click(screen.getByTestId("button-complete-purchase"));
    await waitFor(() => assert.equal(api.items[0]?.quantity, 5));

    await openDashboard();
    await screen.findByText("Your pantry is in good shape.");
    assert.equal(screen.queryByTestId("category-attention-pantry"), null);

    await openInventory();
    fireEvent.click(screen.getByTestId("button-delete-1"));
    fireEvent.click(await screen.findByTestId("button-confirm-delete"));
    await waitFor(() => assert.equal(api.items.length, 0));
    await openDashboard();
    await screen.findByText("Your pantry is in good shape.");
    assert.equal(
      screen.getByTestId("stat-total-items").textContent?.includes("0"),
      true,
    );
  });
});

describe("stock count navigation", () => {
  it("opens matching inventory filters from dashboard counts", async () => {
    const api = new MockPantryApi();
    globalThis.fetch = api.fetch;
    const { queryClient } = renderApp();
    await screen.findByTestId("stat-low-stock");
    assert.equal(screen.getByRole("link", { name: "View Total Items in inventory" }).getAttribute("href"), "/inventory");
    assert.equal(screen.getByRole("link", { name: "View Expiring Soon in inventory" }).getAttribute("href"), "/inventory?stock=expiring");

    fireEvent.click(screen.getByRole("link", { name: "View Low Stock in inventory" }));
    await waitFor(() => assert.equal(screen.getByRole("button", { name: "Low Stock" }).getAttribute("aria-pressed"), "true"));
    await screen.findByText("4 Items");
    assert.equal(screen.queryByTestId("inventory-item-1"), null);

    await openDashboard();
    fireEvent.click(screen.getByRole("link", { name: "View Out of Stock in inventory" }));
    await waitFor(() => assert.equal(screen.getByRole("button", { name: "Out of Stock" }).getAttribute("aria-pressed"), "true"));
    await screen.findByText("2 Items");
    assert.ok(screen.getByTestId("inventory-item-1"));
    assert.ok(screen.getByTestId("inventory-item-9"));
  });
  it("restores stock and category from a direct URL and preserves category when switching stock", async () => {
    const api = new MockPantryApi();
    globalThis.fetch = api.fetch;
    const { queryClient } = renderApp("/inventory?stock=out&category=Dairy");
    await screen.findByText("1 Items");
    assert.equal(screen.getByRole("button", { name: "Out of Stock" }).getAttribute("aria-pressed"), "true");
    assert.ok(screen.getByTestId("inventory-item-1"));
    fireEvent.click(screen.getByRole("button", { name: "Low Stock" }));
    await waitFor(() => assert.equal(screen.getByRole("button", { name: "Low Stock" }).getAttribute("aria-pressed"), "true"));
    await screen.findByText("1 Items");
    assert.ok(screen.getByTestId("inventory-item-2"));
    assert.equal(screen.queryByTestId("inventory-item-1"), null);
    fireEvent.click(screen.getByRole("button", { name: "Produce" }));
    await waitFor(() => assert.ok(screen.getByTestId("inventory-item-5")));
    fireEvent.click(screen.getByRole("button", { name: "Out of Stock" }));
    await screen.findByText("0 Items");
    fireEvent.click(screen.getByRole("button", { name: "Produce" }));
    await screen.findByText("2 Items");
  });
});

describe("inventory quantity validation", () => {
  it("rejects blank quantity while accepting explicit zero and decimals", async () => {
    const api = new GroceryApiMock();
    api.items = [dashboardItem(1, "Rice", "Pantry", 4, 1)];
    globalThis.fetch = api.fetch;
    const { queryClient } = renderApp();

    await screen.findByText("Your pantry is in good shape.");
    const statsBefore = queryClient.getQueryData(
      getGetInventoryStatsQueryKey(),
    );
    const suggestionsBefore = queryClient.getQueryData(
      getGetGrocerySuggestionsQueryKey(),
    );

    await openInventory();
    fireEvent.click(screen.getByTestId("button-edit-1"));
    await screen.findByTestId("dialog-inventory-item");

    changeInput("input-item-quantity", "");
    fireEvent.click(screen.getByTestId("button-save-item"));

    await screen.findByText("Quantity is required");
    assert.equal(api.items[0]?.quantity, 4);
    assert.deepEqual(
      queryClient.getQueryData(getGetInventoryStatsQueryKey()),
      statsBefore,
    );
    assert.deepEqual(
      queryClient.getQueryData(getGetGrocerySuggestionsQueryKey()),
      suggestionsBefore,
    );
    assert.ok(screen.getByTestId("dialog-inventory-item"));

    changeInput("input-item-quantity", "0");
    fireEvent.click(screen.getByTestId("button-save-item"));
    await waitFor(() => assert.equal(api.items[0]?.quantity, 0));

    fireEvent.click(screen.getByTestId("button-edit-1"));
    await screen.findByTestId("dialog-inventory-item");
    changeInput("input-item-quantity", "2.5");
    fireEvent.click(screen.getByTestId("button-save-item"));
    await waitFor(() => assert.equal(api.items[0]?.quantity, 2.5));
  });
});

describe("inventory conflict recovery", () => {
  it("refreshes the revision after a conflict without discarding the draft", async () => {
    const api = new GroceryApiMock();
    api.items = [dashboardItem(1, "Rice", "Pantry", 4, 1)];
    globalThis.fetch = api.fetch;
    renderApp();

    await openInventory();
    fireEvent.click(await screen.findByTestId("button-edit-1"));
    await screen.findByTestId("dialog-inventory-item");
    changeInput("input-item-name", "Updated rice");

    const currentRevision = api.items[0]!.revision;
    assert.equal((await api.fetch("/api/inventory/1", {
      method: "PATCH",
      body: JSON.stringify({ quantity: 5, revision: currentRevision }),
    })).status, 200);

    fireEvent.click(screen.getByTestId("button-save-item"));
    await waitFor(() => assert.equal(
      (screen.getByTestId("button-save-item") as HTMLButtonElement).disabled,
      false,
    ));
    assert.equal((screen.getByTestId("input-item-name") as HTMLInputElement).value, "Updated rice");

    fireEvent.click(screen.getByTestId("button-save-item"));
    await waitFor(() => assert.equal(api.items[0]!.name, "Updated rice"));
    assert.equal(screen.queryByTestId("dialog-inventory-item"), null);
  });
});

describe("inventory optional field clearing", () => {
  it("persists expiry-only, notes-only, and combined clearing", async () => {
    const api = new GroceryApiMock();
    api.items = [dashboardItem(1, "Rice", "Pantry", 4, 1)];
    api.items[0]!.expiresAt = "2026-12-01";
    api.items[0]!.notes = "Keep dry";
    globalThis.fetch = api.fetch;
    const { queryClient } = renderApp();

    await openInventory();
    fireEvent.click(await screen.findByTestId("button-edit-1"));
    await screen.findByTestId("dialog-inventory-item");
    changeInput("input-item-expires", "");
    fireEvent.click(screen.getByTestId("button-save-item"));
    await waitFor(() => assert.equal(api.items[0]?.expiresAt, null));
    assert.equal(api.items[0]?.notes, "Keep dry");
    assert.deepEqual(api.inventoryUpdateBodies.at(-1), {
      name: "Rice",
      category: "Pantry",
      quantity: 4,
      unit: "each",
      minThreshold: 1,
      expiresAt: null,
      notes: "Keep dry",
      revision: 0,
    });

    fireEvent.click(screen.getByTestId("button-edit-1"));
    await screen.findByTestId("dialog-inventory-item");
    changeInput("input-item-expires", "2027-01-15");
    changeInput("input-item-notes", "");
    fireEvent.click(screen.getByTestId("button-save-item"));
    await waitFor(() => assert.equal(api.items[0]?.expiresAt, "2027-01-15"));
    assert.equal(api.items[0]?.notes, null);
    assert.deepEqual(api.inventoryUpdateBodies.at(-1), {
      name: "Rice",
      category: "Pantry",
      quantity: 4,
      unit: "each",
      minThreshold: 1,
      expiresAt: "2027-01-15",
      notes: null,
      revision: 1,
    });

    fireEvent.click(screen.getByTestId("button-edit-1"));
    await screen.findByTestId("dialog-inventory-item");
    changeInput("input-item-expires", "");
    changeInput("input-item-notes", "");
    fireEvent.click(screen.getByTestId("button-save-item"));
    await waitFor(() => {
      assert.equal(api.items[0]?.expiresAt, null);
      assert.equal(api.items[0]?.notes, null);
    });
    assert.deepEqual(api.inventoryUpdateBodies.at(-1), {
      name: "Rice",
      category: "Pantry",
      quantity: 4,
      unit: "each",
      minThreshold: 1,
      expiresAt: null,
      notes: null,
      revision: 2,
    });

    fireEvent.click(screen.getByTestId("button-edit-1"));
    await screen.findByTestId("dialog-inventory-item");
    assert.equal(
      (screen.getByTestId("input-item-expires") as HTMLInputElement).value,
      "",
    );
    assert.equal(
      (screen.getByTestId("input-item-notes") as HTMLTextAreaElement).value,
      "",
    );
  });
});

describe("inventory units and card labels", () => {
  it("offers preset guidance, rejects numeric units, and labels notes", async () => {
    const api = new GroceryApiMock();
    api.items = [
      { ...dashboardItem(1, "Biscuits", "Pantry", 2, 1), unit: "piece", notes: "Keep dry" },
    ];
    globalThis.fetch = api.fetch;
    const { queryClient } = renderApp();

    await openInventory();
    await screen.findByTestId("inventory-item-1");
    assert.ok(screen.getByTestId("input-search"));
    assert.ok(screen.getByText("2 pieces"));
    assert.ok(screen.getByText("Minimum: 1 piece"));
    assert.ok(screen.getByText("Notes:"));
    assert.ok(screen.getByText("Keep dry"));

    fireEvent.click(screen.getByTestId("button-edit-1"));
    await screen.findByTestId("dialog-inventory-item");
    const unitSelect = screen.getByTestId("input-item-unit") as HTMLSelectElement;
    const unitLabel = screen.getByText("Unit", { selector: "label" }) as HTMLLabelElement;
    assert.equal(unitLabel.htmlFor, unitSelect.id);
    assert.ok(unitSelect.getAttribute("aria-describedby")?.includes("form-item-description"));
    changeInput("input-item-unit", "Custom");
    changeInput("input-item-custom-unit", "grams");
    assert.equal((screen.getByTestId("input-item-custom-unit") as HTMLInputElement).value, "grams");
    changeInput("input-item-custom-unit", "2");
    fireEvent.click(screen.getByTestId("button-save-item"));
    await screen.findByText("Choose a unit or enter a custom text unit");
    assert.equal(api.items[0]?.unit, "piece");
    assert.ok(screen.getByTestId("input-item-unit").querySelector('option[value="Custom"]'));
    const customUnitInput = screen.getByTestId("input-item-custom-unit");
    assert.ok(customUnitInput);
    assert.equal(customUnitInput.getAttribute("aria-label"), "Custom unit");
    assert.equal(customUnitInput.getAttribute("aria-invalid"), "true");
    assert.ok(customUnitInput.getAttribute("aria-describedby")?.includes("form-item-message"));
    queryClient.clear();
  });
});
