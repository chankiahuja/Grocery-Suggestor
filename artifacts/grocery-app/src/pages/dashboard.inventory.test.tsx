import assert from "node:assert/strict";
import { afterEach, describe, it } from "node:test";
import React from "react";
import { MockPantryApi } from "../mocks/pantry-api";
import { JSDOM } from "jsdom";
import {
  getListInventoryItemsQueryKey,
  type InventoryItem,
  type ShoppingListWithItems,
} from "@workspace/api-client-react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Route, Router, Switch } from "wouter";
import { memoryLocation } from "wouter/memory-location";

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

const { act, cleanup, fireEvent, render, screen, waitFor } =
  await import("@testing-library/react");
const [
  { default: Dashboard },
  { default: Inventory },
  { default: ShoppingLists },
  { default: ShoppingListDetail },
  { default: Auth },
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
    createdAt: timestamp,
    updatedAt: timestamp,
  };
}

class GroceryApiMock {
  items: InventoryItem[] = [];
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
      return this.json(items);
    }

    if (url.pathname === "/api/inventory" && method === "POST") {
      const input = this.readBody(init);
      const item: InventoryItem = {
        id: this.nextInventoryId++,
        name: String(input.name),
        category: String(input.category),
        quantity: Number(input.quantity),
        unit: String(input.unit),
        minThreshold: Number(input.minThreshold),
        expiresAt: input.expiresAt ? String(input.expiresAt) : null,
        notes: input.notes ? String(input.notes) : null,
        createdAt: timestamp,
        updatedAt: timestamp,
      };
      this.items.push(item);
      return this.json(item, 201);
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
      Object.assign(item, this.readBody(init), { updatedAt: timestamp });
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
  const queryClient = new QueryClient({
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
  globalThis.fetch = originalFetch;
  window.history.replaceState({}, "", "/");
});

describe("login landing routes", () => {
  for (const path of [
    "/",
    "/login",
    "/signup",
    "/dashboard",
    "/inventory",
    "/shopping-lists/12",
    "/unknown/deep/page?from=bookmark",
  ]) {
    it(`opens login first for ${path}`, async () => {
      globalThis.fetch = async () => {
        throw new Error("Landing must not request pantry data");
      };
      const location = memoryLocation({ path });
      render(
        <Router hook={location.hook}>
          <AppRoutes />
        </Router>,
      );
      await screen.findByRole("heading", { name: "Welcome home." });
      assert.equal(screen.queryByRole("heading", { name: "Dashboard" }), null);
      assert.equal(screen.queryByRole("link", { name: "Inventory" }), null);
    });
  }

  it("opens the dashboard after the preview and returns to login on a fresh load", async () => {
    const api = new MockPantryApi();
    globalThis.fetch = api.fetch;
    const location = memoryLocation({ path: "/inventory" });
    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });
    const mount = () =>
      render(
        <QueryClientProvider client={queryClient}>
          <Router hook={location.hook}>
            <AppRoutes />
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
    assert.equal(
      screen.queryByRole("link", { name: "Step into your home" }),
      null,
    );
    await openInventory();
    await openDashboard();
    view.unmount();
    mount();
    await screen.findByRole("heading", { name: "Welcome home." });
    queryClient.clear();
  });
});

describe("logout", () => {
  it("clears preview access and blocks navigation back to app screens", async () => {
    globalThis.fetch = new MockPantryApi().fetch;
    const location = memoryLocation({ path: "/login" });
    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });
    render(
      <QueryClientProvider client={queryClient}>
        <Router hook={location.hook}>
          <AppRoutes />
        </Router>
      </QueryClientProvider>,
    );
    await screen.findByRole("heading", { name: "Welcome home." });
    assert.equal(screen.queryByRole("button", { name: "Logout" }), null);
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
    assert.equal(screen.queryByRole("link", { name: "Sign in" }), null);
    assert.ok(screen.getByRole("button", { name: "Logout" }));
    await openInventory();
    fireEvent.click(screen.getByRole("button", { name: "Logout" }));
    await screen.findByRole("heading", { name: "Welcome home." });
    assert.equal(queryClient.getQueryCache().getAll().length, 0);
    for (const path of ["/dashboard", "/inventory", "/shopping-lists"]) {
      await act(async () => {
        location.navigate(path);
      });
      await screen.findByRole("heading", { name: "Welcome home." });
      assert.equal(screen.queryByRole("button", { name: "Logout" }), null);
    }
    queryClient.clear();
  });
});

describe("mobile sign-in and sign-up preview", () => {
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
    await screen.findByText("Enter exactly 10 digits, without +91 or spaces.");
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
    assert.equal(
      screen.queryByRole("link", { name: "Step into your home" }),
      null,
    );
    assert.equal(screen.queryByLabelText("Verification code"), null);
    fireEvent.click(screen.getByRole("button", { name: "Logout" }));
    assert.equal(
      (screen.getByLabelText("Mobile number") as HTMLInputElement).value,
      "",
    );
    queryClient.clear();
  });

  it("switches to signup and enables resend after the cooldown", async () => {
    const { queryClient } = renderApp("/login");
    fireEvent.click(screen.getByRole("link", { name: "Sign up" }));
    await screen.findByRole("heading", { name: "Make yourself at home." });
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
      queryClient.clear();
    }
  });
});

describe("email OTP preview", () => {
  for (const signup of [false, true]) {
    it(`validates email, preserves it on change, expires/resends OTP, and opens dashboard for ${signup ? "signup" : "login"}`, async () => {
      const api = new MockPantryApi();
      let allowDashboard = false;
      globalThis.fetch = async (input, init) => {
        assert.ok(allowDashboard, "OTP preview must not send network requests");
        return api.fetch(input, init);
      };
      const location = memoryLocation({ path: "/login" });
      const queryClient = new QueryClient({
        defaultOptions: { queries: { retry: false } },
      });
      render(
        <QueryClientProvider client={queryClient}>
          <Router hook={location.hook}>
            <AppRoutes />
          </Router>
        </QueryClientProvider>,
      );
      await screen.findByRole("heading", { name: "Welcome home." });
      if (signup)
        fireEvent.click(screen.getByRole("link", { name: "Sign up" }));
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
        assert.equal(
          screen.queryByRole("link", { name: "Step into your home" }),
          null,
        );
        assert.equal(screen.queryByText("you@example.com"), null);
      } finally {
        Date.now = realNow;
        queryClient.clear();
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
    queryClient.clear();
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
    queryClient.clear();
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
      { category: "produce", attention: 3, out: 1, low: 1, expiring: 3 },
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
    queryClient.clear();
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

    queryClient.clear();
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

    queryClient.clear();
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
    queryClient.clear();
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
    queryClient.clear();
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
    changeInput("input-item-unit", "bags");
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

    queryClient.clear();
  });
});
