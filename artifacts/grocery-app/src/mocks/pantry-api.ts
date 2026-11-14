import type {
  InventoryItem,
  ShoppingListWithItems,
  GrocerySuggestion,
} from "@workspace/api-client-react";
import { isExpired, isExpiringSoon } from "../lib/category-attention";
import {
  shoppingListNameError,
  trimShoppingListBoundaryWhitespace,
} from "../lib/shopping-list-name";
import { isInvalidUnit } from "../lib/inventory-units";

export const MOCK_STORAGE_KEY = "pantrypal-demo-v1";
function normalizeUnit(value: unknown): string | { error: string } {
  if (typeof value !== "string") return { error: "unit is required" };
  const unit = value.trim();
  if (!unit) return { error: "unit is required" };
  if (isInvalidUnit(unit)) return { error: "unit must describe a unit, not only a number" };
  if ([...unit].length > 64) return { error: "unit must be 64 characters or fewer" };
  return unit;
}
type State = {
  inventory: InventoryItem[];
  lists: ShoppingListWithItems[];
  applied: number[];
  revisions?: Record<number, number>;
  adjustments?: {
    inventoryItemId: number;
    key: string;
    operation: "consume" | "restock";
    amount: number;
    previousQuantity?: number;
    revision?: number;
    expiresAt?: number;
    undone?: boolean;
  }[];
  nextId: number;
};

function storedRevision(value: unknown): number | undefined {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0
    ? value
    : undefined;
}

function normalizeState(state: State): State {
  const revisions = { ...(state.revisions ?? {}) };
  const inventory = state.inventory.map((item) => {
    const revision = Math.max(
      storedRevision(item.revision) ?? 0,
      storedRevision(revisions[item.id]) ?? 0,
    );
    revisions[item.id] = revision;
    return { ...item, revision };
  });
  return { ...state, inventory, revisions };
}

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
      revision: 0,
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
    state: State = seedState(),
    private persist: (state: State) => void = () => {},
  ) {
    this.state = normalizeState(state);
  }
  public state: State;
  private json(data: unknown, status = 200) {
    return new Response(status === 204 ? null : JSON.stringify(data), {
      status,
      headers: { "Content-Type": "application/json" },
    });
  }
  private expiring(item: InventoryItem) {
    return item.quantity > 0 && isExpiringSoon(item.expiresAt);
  }
  private suggestions(): GrocerySuggestion[] {
    return this.state.inventory
      .flatMap((item): GrocerySuggestion[] => {
        const urgency =
          item.quantity === 0
            ? "critical"
            : item.quantity > 0 && isExpired(item.expiresAt)
              ? "expired"
              : this.expiring(item)
                ? "expiring_soon"
                : item.quantity <= item.minThreshold
                  ? "low"
                  : null;
        if (!urgency) return [];
        const stock = item.quantity > 0 && item.quantity <= item.minThreshold
          ? `${item.quantity} ${item.unit} left (minimum is ${item.minThreshold} ${item.unit})`
          : null;
        return [{
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
                      ? stock!
                      : `${urgency === "expired" ? "Expired" : "Expires"} on ${item.expiresAt}${stock ? `; ${stock}` : ""}`,
              }];
      })
      .sort(
        (a, b) =>
          ["expired", "critical", "expiring_soon", "low"].indexOf(a.urgency) -
          ["expired", "critical", "expiring_soon", "low"].indexOf(b.urgency),
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
    let body = raw ? JSON.parse(String(raw)) : {};
    const parts = url.pathname.split("/").filter(Boolean).slice(1);
    const id = Number(parts[1]);
    const now = new Date().toISOString();
    const save = (data: unknown, status = 200) => {
      this.persist(this.state);
      return this.json(data, status);
    };
    const missing = () => this.json({ error: "Resource not found" }, 404);
    const revise = (itemId: number) => {
      const revisions = (this.state.revisions ??= {});
      return (revisions[itemId] = (revisions[itemId] ?? 0) + 1);
    };

    if (parts[0] === "healthz") return this.json({ status: "ok" });
    if (parts[0] === "feedback") {
      if (method === "GET" && parts[1] === "config") return this.json({ supportEmail: null, responseTime: null });
      if (method === "POST") return this.json({ error: "Support is not configured in the browser demo." }, 503);
    }
    if (parts[0] === "suggestions") {
      const suggestions = this.suggestions();
      if (method === "GET" && parts.length === 1) return this.json(suggestions);
      if (method === "POST" && parts[1] === "generate-list") {
        const stock = suggestions.filter((s) => s.currentQuantity === 0 || s.currentQuantity <= s.minThreshold);
        if (!stock.length)
          return this.json(
            { error: "No low-stock suggestions are available." },
            400,
          );
        const selected = new Map<GrocerySuggestion["inventoryItemId"], GrocerySuggestion & { quantity: number }>();
        if (body.items == null) {
          for (const suggestion of stock) {
            selected.set(suggestion.inventoryItemId, {
              ...suggestion,
              quantity: Math.max(suggestion.minThreshold - suggestion.currentQuantity, 1),
            });
          }
        } else {
          if (!Array.isArray(body.items))
            return this.json({ error: "items must be an array" }, 400);
          for (const item of body.items) {
            if (
              !item ||
              !Number.isSafeInteger(item.inventoryItemId) ||
              item.inventoryItemId <= 0 ||
              typeof item.quantity !== "number" ||
              !Number.isFinite(item.quantity) ||
              item.quantity < 0
            ) return this.json({ error: "Invalid generated item" }, 400);
            const suggestion = stock.find((s) => s.inventoryItemId === item.inventoryItemId);
            if (!suggestion)
              return this.json({ error: "Selected item is no longer a low-stock suggestion" }, 400);
            if (item.quantity === 0) continue;
            const quantity = (selected.get(item.inventoryItemId)?.quantity ?? 0) + item.quantity;
            if (!Number.isFinite(quantity))
              return this.json({ error: "Invalid generated item" }, 400);
            selected.set(item.inventoryItemId, { ...suggestion, quantity });
          }
        }
        if (!selected.size)
          return this.json({ error: "Select at least one shopping item." }, 400);
        const list: ShoppingListWithItems = {
          id: this.state.nextId++,
          name: "Low-stock shopping list",
          createdAt: now,
          updatedAt: now,
          items: [],
        };
        list.items = [...selected.values()].map((s) => ({
          id: this.state.nextId++,
          shoppingListId: list.id,
          inventoryItemId: s.inventoryItemId,
          name: s.name,
          category: s.category,
          quantity: s.quantity,
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
          expiredCount: items.filter((i) => i.quantity > 0 && isExpired(i.expiresAt)).length,
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
                    (i.quantity > 0 && i.quantity <= i.minThreshold)) &&
                  (url.searchParams.get("outOfStock") !== "true" ||
                    i.quantity === 0),
              )
              .sort((a, b) => a.name.localeCompare(b.name)),
          );
        if (method === "POST") {
          const item: InventoryItem = {
            ...body,
            id: this.state.nextId++,
            expiresAt: body.expiresAt || null,
            notes: body.notes ?? null,
            revision: 0,
            createdAt: now,
            updatedAt: now,
          };
          this.state.inventory.push(item);
          return save(item, 201);
        }
      } else {
        const item = this.state.inventory.find((i) => i.id === id);
        if (!item) return missing();
        if (parts.length === 3 && parts[2] === "undo" && method === "POST") {
          const key = body?.idempotencyKey;
          if (typeof key !== "string" || !key.trim() || key.length > 128)
            return this.json({ error: "idempotencyKey must be 1 to 128 characters" }, 400);
          const adjustment = this.state.adjustments?.find((entry) => entry.inventoryItemId === id && entry.key === key);
          if (!adjustment) return missing();
          if (adjustment.undone) return this.json({ status: "already_undone", inventory: item });
          if (adjustment.revision === undefined || adjustment.previousQuantity === undefined || adjustment.expiresAt === undefined)
            return this.json({ error: "Historical adjustment cannot be undone" }, 409);
          if (Date.now() >= adjustment.expiresAt)
            return this.json({ error: "Undo window expired" }, 410);
          if (this.state.revisions?.[id] !== adjustment.revision)
            return this.json({ error: "Inventory changed after adjustment" }, 409);
          item.quantity = adjustment.previousQuantity;
          item.updatedAt = now;
          item.revision = revise(id);
          adjustment.undone = true;
          return save({ status: "undone", inventory: item });
        }
        if (parts.length === 3 && parts[2] === "adjust" && method === "POST") {
          const key = new Headers(init?.headers ?? request?.headers).get(
            "Idempotency-Key",
          );
          if (!key?.trim() || key.length > 128)
            return this.json({ error: "Idempotency-Key must be 1 to 128 characters" }, 400);
          const operation = body?.operation;
          const amount = body?.amount;
          if (operation !== "consume" && operation !== "restock")
            return this.json({ error: "operation must be consume or restock" }, 400);
          if (typeof amount !== "number" || !Number.isFinite(amount) || amount <= 0)
            return this.json({ error: "amount must be greater than zero" }, 400);
          const previous = this.state.adjustments?.find(
            (entry) => entry.inventoryItemId === id && entry.key === key,
          );
          if (previous) {
            if (previous.operation !== operation || previous.amount !== amount)
              return this.json(
                { error: "Idempotency-Key was already used for a different adjustment" },
                400,
              );
            return this.json(item);
          }
          if (operation === "consume" && amount > item.quantity)
            return this.json({ error: "amount exceeds available stock" }, 400);
          const previousQuantity = item.quantity;
          item.quantity += operation === "consume" ? -amount : amount;
          item.updatedAt = now;
          const revision = revise(id);
          item.revision = revision;
          (this.state.adjustments ??= []).push({
            inventoryItemId: id,
            key,
            operation,
            amount,
            previousQuantity,
            revision,
            expiresAt: Date.now() + 5 * 60_000,
          });
          return save(item);
        }
        if (method === "GET") return this.json(item);
        if (method === "PATCH") {
          if (typeof body.revision !== "number" || body.revision !== item.revision)
            return this.json({ error: "Inventory item was modified; reload and try again" }, 409);
          const { revision: _revision, ...update } = body;
          Object.assign(item, update, { updatedAt: now });
          item.revision = revise(id);
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
          if (typeof body.name !== "string")
            return this.json({ error: "name is required" }, 400);
          const nameError = shoppingListNameError(body.name);
          if (nameError) return this.json({ error: nameError }, 400);
          const list: ShoppingListWithItems = {
            id: this.state.nextId++,
            name: trimShoppingListBoundaryWhitespace(body.name),
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
        if (method === "PATCH") {
          if (typeof body.name !== "string")
            return this.json({ error: "name is required" }, 400);
          const nameError = shoppingListNameError(body.name);
          if (nameError) return this.json({ error: nameError }, 400);
          list.name = trimShoppingListBoundaryWhitespace(body.name);
          list.updatedAt = now;
          return save(list);
        }
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
            item.revision = revise(item.id);
            this.state.applied.push(row.id);
            count++;
          }
        }
        return save({ purchasedCount: count, updatedInventoryItems: count });
      }
      if (parts[2] === "items") {
        if (parts.length === 3 && method === "POST") {
          const unit = normalizeUnit(body.unit);
          if (typeof unit !== "string") return this.json(unit, 400);
          const row = {
            ...body,
            unit,
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
          if (Object.prototype.hasOwnProperty.call(body, "unit")) {
            const unit = normalizeUnit(body.unit);
            if (typeof unit !== "string") return this.json(unit, 400);
            if (row.inventoryItemId != null) {
              const inventoryItem = this.state.inventory.find((candidate) => candidate.id === row.inventoryItemId);
              if (inventoryItem && unit !== inventoryItem.unit.trim()) {
                return this.json({ error: "Inventory-linked items must use the inventory unit" }, 400);
              }
            }
            body = { ...body, unit };
          }
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
