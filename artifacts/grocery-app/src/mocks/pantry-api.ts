import type {
  InventoryItem,
  ShoppingListWithItems,
  GrocerySuggestion,
} from "@workspace/api-client-react";

export const MOCK_STORAGE_KEY = "pantrypal-demo-v1";
type State = {
  inventory: InventoryItem[];
  lists: ShoppingListWithItems[];
  applied: number[];
  nextId: number;
};

export function seedState(): State {
  const now = new Date().toISOString();
  const date = (days: number) =>
    new Date(Date.now() + days * 86400000).toISOString().slice(0, 10);
  const entries: [string, string, number, string, number, number | null][] = [
    ["Milk", "Dairy", 0, "litres", 2, null],
    ["Eggs", "Dairy", 4, "each", 6, 5],
    ["Greek yogurt", "Dairy", 3, "each", 1, 2],
    ["Tomatoes", "Produce", 2, "kg", 0.5, 3],
    ["Spinach", "Produce", 1, "bunches", 1, 2],
    ["Apples", "Produce", 8, "each", 3, 12],
    ["Rice", "Pantry", 0.5, "kg", 2, null],
    ["Pasta", "Pantry", 3, "packets", 1, null],
    ["Olive oil", "Pantry", 0, "bottles", 1, null],
    ["Whole wheat bread", "Bakery", 2, "loaves", 1, 1],
    ["Coffee", "Beverages", 1, "packets", 1, null],
    ["Frozen peas", "Frozen", 2, "bags", 1, 60],
  ];
  const inventory = entries.map(
    ([name, category, quantity, unit, minThreshold, days], index) => ({
      id: index + 1,
      name,
      category,
      quantity,
      unit,
      minThreshold,
      expiresAt: days === null ? null : date(days),
      notes: null,
      createdAt: now,
      updatedAt: now,
    }),
  );
  return {
    inventory,
    nextId: 100,
    applied: [],
    lists: [
      {
        id: 20,
        name: "Weekend groceries",
        createdAt: now,
        updatedAt: now,
        items: [
          {
            id: 21,
            shoppingListId: 20,
            inventoryItemId: 1,
            name: "Milk",
            category: "Dairy",
            quantity: 2,
            unit: "litres",
            purchased: false,
            notes: "For breakfast and coffee",
          },
          {
            id: 22,
            shoppingListId: 20,
            inventoryItemId: 7,
            name: "Rice",
            category: "Pantry",
            quantity: 2,
            unit: "kg",
            purchased: false,
            notes: null,
          },
        ],
      },
    ],
  };
}

/** Browser-only demo adapter, using the same REST response shapes as Spring. */
export class MockPantryApi {
  constructor(
    public state: State = seedState(),
    private persist: (state: State) => void = () => {},
  ) {}
  private json(data: unknown, status = 200) {
    return new Response(status === 204 ? null : JSON.stringify(data), {
      status,
      headers: { "Content-Type": "application/json" },
    });
  }
  private expiring(item: InventoryItem) {
    const today = new Date().toISOString().slice(0, 10);
    const last = new Date(Date.now() + 7 * 86400000).toISOString().slice(0, 10);
    return (
      item.expiresAt != null &&
      item.expiresAt >= today &&
      item.expiresAt <= last
    );
  }
  private suggestions(): GrocerySuggestion[] {
    return this.state.inventory
      .flatMap((item): GrocerySuggestion[] => {
        const urgency =
          item.quantity === 0
            ? "critical"
            : item.quantity <= item.minThreshold
              ? "low"
              : this.expiring(item)
                ? "expiring_soon"
                : null;
        return urgency
          ? [
              {
                inventoryItemId: item.id,
                name: item.name,
                category: item.category,
                currentQuantity: item.quantity,
                minThreshold: item.minThreshold,
                unit: item.unit,
                urgency,
                reason:
                  urgency === "critical"
                    ? "Out of stock"
                    : urgency === "low"
                      ? `${item.quantity} ${item.unit} left (minimum is ${item.minThreshold} ${item.unit})`
                      : `Expires on ${item.expiresAt}`,
              },
            ]
          : [];
      })
      .sort(
        (a, b) =>
          ["critical", "low", "expiring_soon"].indexOf(a.urgency) -
          ["critical", "low", "expiring_soon"].indexOf(b.urgency),
      );
  }
  readonly fetch = async (
    input: RequestInfo | URL,
    init?: RequestInit,
  ): Promise<Response> => {
    const request = input instanceof Request ? input : null;
    const url = new URL(
      request ? request.url : String(input),
      "http://localhost",
    );
    const method = (init?.method ?? request?.method ?? "GET").toUpperCase();
    const raw =
      init?.body ?? (request && method !== "GET" ? await request.text() : null);
    const body = raw ? JSON.parse(String(raw)) : {};
    const parts = url.pathname.split("/").filter(Boolean).slice(1);
    const id = Number(parts[1]);
    const now = new Date().toISOString();
    const save = (data: unknown, status = 200) => {
      this.persist(this.state);
      return this.json(data, status);
    };
    const missing = () => this.json({ error: "Resource not found" }, 404);

    if (parts[0] === "healthz") return this.json({ status: "ok" });
    if (parts[0] === "suggestions") {
      const suggestions = this.suggestions();
      if (method === "GET" && parts.length === 1) return this.json(suggestions);
      if (method === "POST" && parts[1] === "generate-list") {
        const stock = suggestions.filter((s) => s.urgency !== "expiring_soon");
        if (!stock.length)
          return this.json(
            { error: "No low-stock suggestions are available." },
            400,
          );
        const list: ShoppingListWithItems = {
          id: this.state.nextId++,
          name: "Low-stock shopping list",
          createdAt: now,
          updatedAt: now,
          items: [],
        };
        list.items = stock.map((s) => ({
          id: this.state.nextId++,
          shoppingListId: list.id,
          inventoryItemId: s.inventoryItemId,
          name: s.name,
          category: s.category,
          quantity: Math.max(s.minThreshold - s.currentQuantity, 1),
          unit: s.unit,
          notes: s.reason,
          purchased: false,
        }));
        this.state.lists.push(list);
        return save(list, 201);
      }
    }
    if (parts[0] === "inventory") {
      if (parts[1] === "stats" && method === "GET") {
        const items = this.state.inventory;
        return this.json({
          totalItems: items.length,
          lowStockCount: items.filter(
            (i) => i.quantity > 0 && i.quantity <= i.minThreshold,
          ).length,
          outOfStockCount: items.filter((i) => i.quantity === 0).length,
          expiringCount: items.filter((i) => this.expiring(i)).length,
          categoryBreakdown: [...new Set(items.map((i) => i.category))].map(
            (category) => ({
              category,
              count: items.filter((i) => i.category === category).length,
            }),
          ),
        });
      }
      if (parts.length === 1) {
        if (method === "GET")
          return this.json(
            this.state.inventory
              .filter(
                (i) =>
                  (!url.searchParams.has("category") ||
                    i.category === url.searchParams.get("category")) &&
                  (url.searchParams.get("lowStock") !== "true" ||
                    i.quantity <= i.minThreshold),
              )
              .sort((a, b) => a.name.localeCompare(b.name)),
          );
        if (method === "POST") {
          const item: InventoryItem = {
            ...body,
            id: this.state.nextId++,
            expiresAt: body.expiresAt || null,
            notes: body.notes ?? null,
            createdAt: now,
            updatedAt: now,
          };
          this.state.inventory.push(item);
          return save(item, 201);
        }
      } else {
        const item = this.state.inventory.find((i) => i.id === id);
        if (!item) return missing();
        if (method === "GET") return this.json(item);
        if (method === "PATCH") {
          Object.assign(item, body, { updatedAt: now });
          return save(item);
        }
        if (method === "DELETE") {
          this.state.inventory = this.state.inventory.filter(
            (i) => i.id !== id,
          );
          this.state.lists.forEach((list) =>
            list.items.forEach((row) => {
              if (row.inventoryItemId === id) row.inventoryItemId = null;
            }),
          );
          return save(null, 204);
        }
      }
    }
    if (parts[0] === "shopping-lists") {
      if (parts.length === 1) {
        if (method === "GET")
          return this.json(
            this.state.lists.map(({ items, ...list }) => ({
              ...list,
              itemCount: items.length,
              purchasedCount: items.filter((i) => i.purchased).length,
            })),
          );
        if (method === "POST") {
          const list: ShoppingListWithItems = {
            id: this.state.nextId++,
            name: body.name,
            items: [],
            createdAt: now,
            updatedAt: now,
          };
          this.state.lists.push(list);
          const { items, ...summary } = list;
          return save(
            { ...summary, itemCount: items.length, purchasedCount: 0 },
            201,
          );
        }
      }
      const list = this.state.lists.find((l) => l.id === id);
      if (!list) return missing();
      if (parts.length === 2) {
        if (method === "GET") return this.json(list);
        if (method === "DELETE") {
          this.state.lists = this.state.lists.filter((l) => l.id !== id);
          return save(null, 204);
        }
      }
      if (parts[2] === "purchase" && method === "POST") {
        let count = 0;
        for (const row of list.items) {
          const item = this.state.inventory.find(
            (i) => i.id === row.inventoryItemId,
          );
          if (row.purchased && item && !this.state.applied.includes(row.id)) {
            item.quantity += row.quantity;
            item.updatedAt = now;
            this.state.applied.push(row.id);
            count++;
          }
        }
        return save({ purchasedCount: count, updatedInventoryItems: count });
      }
      if (parts[2] === "items") {
        if (parts.length === 3 && method === "POST") {
          const row = {
            ...body,
            id: this.state.nextId++,
            shoppingListId: id,
            inventoryItemId: body.inventoryItemId ?? null,
            notes: body.notes ?? null,
            purchased: false,
          };
          list.items.push(row);
          return save(row, 201);
        }
        const row = list.items.find((i) => i.id === Number(parts[3]));
        if (!row) return missing();
        if (method === "PATCH") {
          Object.assign(row, body);
          return save(row);
        }
        if (method === "DELETE") {
          list.items = list.items.filter((i) => i.id !== row.id);
          return save(null, 204);
        }
      }
    }
    return this.json({ error: "Unsupported demo request" }, 404);
  };
}

export function installMockApi() {
  let state = seedState();
  try {
    const saved = localStorage.getItem(MOCK_STORAGE_KEY);
    if (saved) {
      const parsed = JSON.parse(saved);
      if (
        Array.isArray(parsed.inventory) &&
        Array.isArray(parsed.lists) &&
        Array.isArray(parsed.applied) &&
        Number.isFinite(parsed.nextId)
      )
        state = parsed;
    }
  } catch {
    /* Start fresh if browser storage is unavailable. */
  }
  const api = new MockPantryApi(state, (value) => {
    try {
      localStorage.setItem(MOCK_STORAGE_KEY, JSON.stringify(value));
    } catch {
      /* Session still works. */
    }
  });
  const realFetch = window.fetch.bind(window);
  window.fetch = (input, init) => {
    const url = new URL(
      input instanceof Request ? input.url : String(input),
      window.location.origin,
    );
    return url.origin === window.location.origin &&
      url.pathname.startsWith("/api/")
      ? api.fetch(input, init)
      : realFetch(input, init);
  };
}
