import assert from "node:assert/strict";
import { test } from "node:test";
import { MockPantryApi, seedState } from "./pantry-api";
import type { InventoryItem } from "@workspace/api-client-react";

test("demo shopping-list creation and rename share Unicode name validation", async () => {
  const api = new MockPantryApi();
  const create = async (name: unknown) => api.fetch("/api/shopping-lists", {
    method: "POST", body: JSON.stringify({ name }),
  });
  for (const name of ["\ufeff", "\u00a0", "\u2003", "a".repeat(101), "😀".repeat(101)]) {
    assert.equal((await create(name)).status, 400);
  }
  const createdResponse = await create(`\ufeff${"😀".repeat(100)}\u3000`);
  assert.equal(createdResponse.status, 201);
  const created = await createdResponse.json();
  assert.equal(created.name, "😀".repeat(100));

  const renamedResponse = await api.fetch(`/api/shopping-lists/${created.id}`, {
    method: "PATCH", body: JSON.stringify({ name: "  Weekly\u00a0 shop  " }),
  });
  assert.equal(renamedResponse.status, 200);
  assert.equal((await renamedResponse.json()).name, "Weekly\u00a0 shop");

  api.state.lists[0].name = "L".repeat(101);
  assert.equal((await (await api.fetch(`/api/shopping-lists/${api.state.lists[0].id}`)).json()).name, "L".repeat(101));
  assert.equal((await api.fetch(`/api/shopping-lists/${api.state.lists[0].id}`, {
    method: "PATCH", body: JSON.stringify({ name: "Valid" }),
  })).status, 200);
});

test("demo rejects incompatible linked units before changing any fields", async () => {
  const api = new MockPantryApi();
  const row = api.state.lists[0].items[0];
  const before = structuredClone(row);
  const rejected = await api.fetch(`/api/shopping-lists/20/items/${row.id}`, {
    method: "PATCH",
    body: JSON.stringify({ quantity: 99, notes: "changed", unit: "kg" }),
  });
  assert.equal(rejected.status, 400);
  assert.deepEqual(row, before);

  row.unit = "legacy-invalid-unit";
  const omittedUnit = await api.fetch(`/api/shopping-lists/20/items/${row.id}`, {
    method: "PATCH",
    body: JSON.stringify({ notes: "" }),
  });
  assert.equal(omittedUnit.status, 200);
  assert.equal(row.unit, "legacy-invalid-unit");
  assert.equal(row.notes, "");
});

test("demo item creation validates trimmed Unicode units", async () => {
  const api = new MockPantryApi();
  const create = (unit: string) => api.fetch("/api/shopping-lists/20/items", {
    method: "POST",
    body: JSON.stringify({ name: "Custom item", category: "Pantry", quantity: 1, unit }),
  });
  for (const unit of ["2.5", "-2", "２", "١٢", "1/2", "   "]) {
    assert.equal((await create(unit)).status, 400, unit);
  }
  const emoji = String.fromCodePoint(0x1f600);
  const response = await create(` ${emoji.repeat(64)} `);
  assert.equal(response.status, 201);
  assert.equal((await response.json()).unit, emoji.repeat(64));
});

test("expired demo alerts clear on correction and never create expiry-only purchases", async () => {
  const api = new MockPantryApi();
  const template = api.state.inventory[0];
  api.state.inventory = [
    { ...template, id: 101, name: "Expired only", quantity: 5, minThreshold: 2, expiresAt: "2000-01-01" },
    { ...template, id: 102, name: "Expired low", quantity: 1, minThreshold: 2, expiresAt: "2000-01-01" },
    { ...template, id: 103, name: "Empty expired", quantity: 0, minThreshold: 2, expiresAt: "2000-01-01" },
  ];
  const alerts = await (await api.fetch("/api/suggestions")).json();
  assert.deepEqual(alerts.filter((a: any) => a.urgency === "expired").map((a: any) => a.inventoryItemId), [101, 102]);
  assert.equal((await (await api.fetch("/api/inventory/stats")).json()).expiredCount, 2);
  const invalid = await api.fetch("/api/suggestions/generate-list", { method: "POST", body: JSON.stringify({ items: [{ inventoryItemId: 101, quantity: 1 }] }) });
  assert.equal(invalid.status, 400);
  const list = await (await api.fetch("/api/suggestions/generate-list", { method: "POST" })).json();
  assert.deepEqual(list.items.map((i: any) => i.inventoryItemId), [102, 103]);
  await api.fetch("/api/inventory/101", { method: "PATCH", body: JSON.stringify({ expiresAt: null, revision: api.state.inventory.find((item) => item.id === 101)!.revision }) });
  await api.fetch("/api/inventory/102", { method: "DELETE" });
  assert.equal((await (await api.fetch("/api/inventory/stats")).json()).expiredCount, 0);
  assert.ok((await (await api.fetch("/api/suggestions")).json()).every((a: any) => a.urgency !== "expired"));
});

test("demo suggestions prioritize expiry, retain stock context, and ignore expiry for empty items", async () => {
  const api = new MockPantryApi();
  const template = api.state.inventory[0];
  const soon = new Date(Date.now() + 3 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
  api.state.inventory = [
    { ...template, id: 201, name: "Expiring low", quantity: 1.5, minThreshold: 2, expiresAt: soon },
    { ...template, id: 202, name: "Empty future", quantity: 0, minThreshold: 2, expiresAt: soon },
  ];
  const alerts = await (await api.fetch("/api/suggestions")).json();
  const expiring = alerts.find((a: any) => a.inventoryItemId === 201);
  assert.equal(expiring.urgency, "expiring_soon");
  assert.match(expiring.reason, /minimum is 2/);
  assert.deepEqual(alerts.find((a: any) => a.inventoryItemId === 202).urgency, "critical");
  assert.equal((await (await api.fetch("/api/inventory/stats")).json()).expiringCount, 1);
});

test("browser demo keeps feedback unconfigured rather than reporting a false delivery", async () => {
  const api = new MockPantryApi();
  const config = await (await api.fetch("/api/feedback/config")).json();
  assert.deepEqual(config, { supportEmail: null, responseTime: null });
  const response = await api.fetch("/api/feedback", {
    method: "POST",
    body: JSON.stringify({ category: "idea", message: "A suggestion" }),
  });
  assert.equal(response.status, 503);
});

function undo(api: MockPantryApi, key = "adjustment-1", id = 2) {
  return api.fetch(`/api/inventory/${id}/undo`, { method: "POST", body: JSON.stringify({ idempotencyKey: key }) });
}

test("demo Undo persists and retries do not restore stock twice or reapply adjustments", async () => {
  let saved = "";
  const api = new MockPantryApi(undefined, (state) => { saved = JSON.stringify(state); });
  await adjust(api, { operation: "consume", amount: 1 });
  const first = await undo(api);
  assert.equal((await first.json()).status, "undone");
  assert.equal(api.state.inventory[1].quantity, 4);
  const reloaded = new MockPantryApi(JSON.parse(saved));
  assert.equal((await (await undo(reloaded)).json()).status, "already_undone");
  await adjust(reloaded, { operation: "consume", amount: 1 });
  assert.equal(reloaded.state.inventory[1].quantity, 4);
});

test("demo Undo rejects expired, historical, missing and intervening writes including ABA and purchases", async () => {
  for (const change of ["expiry", "historical", "edit", "adjustment", "purchase"] as const) {
    const api = new MockPantryApi();
    await adjust(api, { operation: "restock", amount: 1 }, "adjustment-1", 1);
    if (change === "expiry") api.state.adjustments![0].expiresAt = Date.now() - 1;
    if (change === "historical") delete api.state.adjustments![0].revision;
    if (change === "edit") {
      for (const quantity of [2, 1]) {
        const item = api.state.inventory.find((candidate) => candidate.id === 1)!;
        await api.fetch("/api/inventory/1", { method: "PATCH", body: JSON.stringify({ quantity, revision: item.revision }) });
      }
    }
    if (change === "adjustment") await adjust(api, { operation: "consume", amount: 1 }, "later", 1);
    if (change === "purchase") {
      await api.fetch("/api/shopping-lists/20/items/21", { method: "PATCH", body: JSON.stringify({ purchased: true }) });
      await api.fetch("/api/shopping-lists/20/purchase", { method: "POST" });
    }
    const before = JSON.stringify(api.state);
    assert.equal((await undo(api, "adjustment-1", 1)).status, change === "expiry" ? 410 : 409);
    assert.equal(JSON.stringify(api.state), before);
    assert.equal((await undo(api, "missing", 1)).status, 404);
  }
});

function adjust(
  api: MockPantryApi,
  body: unknown,
  key: string | undefined = "adjustment-1",
  id = 2,
) {
  return api.fetch(`/api/inventory/${id}/adjust`, {
    method: "POST",
    headers: key === undefined ? {} : { "Idempotency-Key": key },
    body: JSON.stringify(body),
  });
}

test("consume and restock adjust quantities, preserve item fields, and persist", async () => {
  let saves = 0;
  const api = new MockPantryApi(undefined, () => saves++);
  const original = { ...api.state.inventory[1] };
  api.state.inventory[1].updatedAt = "2000-01-01T00:00:00.000Z";
  const consumed = await adjust(api, { operation: "consume", amount: 1.5 });
  assert.equal(consumed.status, 200);
  const item = await consumed.json();
  assert.equal(item.quantity, 2.5);
  assert.notEqual(item.updatedAt, "2000-01-01T00:00:00.000Z");
  assert.deepEqual(item, { ...original, quantity: 2.5, revision: 1, updatedAt: item.updatedAt });
  const restocked = await adjust(api, { operation: "restock", amount: 0.5 }, "restock");
  assert.equal(restocked.status, 200);
  const restockedItem = await restocked.json();
  assert.deepEqual(restockedItem, { ...original, quantity: 3, revision: 2, updatedAt: restockedItem.updatedAt });
  const emptied = await adjust(api, { operation: "consume", amount: 3 }, "empty");
  assert.equal(emptied.status, 200);
  assert.equal((await emptied.json()).revision, 3);
  assert.equal(saves, 3);
});

test("invalid adjustments and insufficient stock leave state and keys unchanged", async () => {
  let saves = 0;
  const api = new MockPantryApi(undefined, () => saves++);
  const before = JSON.stringify(api.state);
  const bodies = [
    {}, null, { operation: "replace", amount: 1 },
    { operation: "CONSUME", amount: 1 },
    ...[undefined, null, "1", true, 0, -1].map((amount) => ({ operation: "consume", amount })),
    { operation: "consume", amount: 5 },
  ];
  for (const body of bodies) {
    assert.equal((await adjust(api, body)).status, 400, JSON.stringify(body));
  }
  // JSON exponent overflow exercises non-finite numbers without JSON.stringify converting them to null.
  for (const amount of ["1e309", "-1e309"]) {
    const response = await api.fetch("/api/inventory/2/adjust", {
      method: "POST",
      headers: { "Idempotency-Key": "adjustment-1" },
      body: `{"operation":"restock","amount":${amount}}`,
    });
    assert.equal(response.status, 400);
  }
  assert.equal(JSON.stringify(api.state), before);
  assert.equal(saves, 0);
  assert.equal((await adjust(api, { operation: "consume", amount: 1 })).status, 200);
});

test("adjustment keys are required, bounded, and read from Request or init headers", async () => {
  const api = new MockPantryApi();
  const body = { operation: "restock", amount: 1 };
  for (const key of ["", "   ", "a".repeat(129)]) {
    assert.equal((await adjust(api, body, key)).status, 400);
  }
  assert.equal((await api.fetch("/api/inventory/2/adjust", {
    method: "POST", body: JSON.stringify(body),
  })).status, 400);
  assert.equal((await adjust(api, body, "a")).status, 200);
  assert.equal((await adjust(api, body, "b".repeat(128))).status, 200);
  const request = () => new Request("http://localhost/api/inventory/2/adjust", {
    method: "POST",
    headers: { "idempotency-key": "request-key" },
    body: JSON.stringify(body),
  });
  assert.equal((await api.fetch(request())).status, 200);
  assert.equal((await api.fetch(request())).status, 200);
  assert.equal(api.state.inventory[1].quantity, 7);
  assert.equal((await api.fetch(request(), {
    headers: new Headers({ "IDEMPOTENCY-KEY": "override-key" }),
  })).status, 200);
  assert.equal(api.state.inventory[1].quantity, 8);
});

test("replay returns current inventory without a mutation and rejects conflicting payloads", async () => {
  let saves = 0;
  const api = new MockPantryApi(undefined, () => saves++);
  const body = { operation: "consume", amount: 3 };
  assert.equal((await adjust(api, body)).status, 200);
  // A replay still succeeds when current stock can no longer cover the original amount.
  assert.equal((await adjust(api, body)).status, 200);
  assert.equal(saves, 1);
  await api.fetch("/api/inventory/2", {
    method: "PATCH", body: JSON.stringify({ quantity: 0, notes: "Changed later", revision: api.state.inventory.find((item) => item.id === 2)!.revision }),
  });
  const before = JSON.stringify(api.state);
  const replay = await adjust(api, body);
  assert.equal(replay.status, 200);
  assert.deepEqual(await replay.json(), api.state.inventory[1]);
  for (const conflicting of [
    { operation: "restock", amount: 3 },
    { operation: "consume", amount: 2 },
  ]) {
    assert.equal((await adjust(api, conflicting)).status, 400);
  }
  assert.equal(JSON.stringify(api.state), before);
  assert.equal(saves, 2);
  // Keys belong to an item, so another item may use the same key independently.
  assert.equal((await adjust(api, { operation: "restock", amount: 2 }, "adjustment-1", 1)).status, 200);
  assert.equal(api.state.inventory[0].quantity, 2);
  assert.equal((await adjust(api, body, "missing", 99999)).status, 404);
});

test("old demo state accepts adjustments and persisted keys survive a storage round trip", async () => {
  const oldState = seedState();
  delete oldState.revisions;
  delete (oldState.inventory[1] as Partial<InventoryItem>).revision;
  assert.equal(oldState.adjustments, undefined);
  let stored = JSON.stringify(oldState);
  const api = new MockPantryApi(JSON.parse(stored), (state) => {
    stored = JSON.stringify(state);
  });
  const body = { operation: "restock", amount: 2 };
  const legacyItem = api.state.inventory[1]!;
  assert.equal((await api.fetch("/api/inventory/2", {
    method: "PATCH",
    body: JSON.stringify({ notes: "Legacy edit", revision: legacyItem.revision }),
  })).status, 200);
  assert.equal((await adjust(api, body)).status, 200);
  let replaySaves = 0;
  const reloaded = new MockPantryApi(JSON.parse(stored), () => replaySaves++);
  const replay = await adjust(reloaded, body);
  assert.equal(replay.status, 200);
  assert.equal((await replay.json()).quantity, 6);
  assert.equal(reloaded.state.inventory[1]!.notes, "Legacy edit");
  assert.equal(replaySaves, 0);
  assert.equal((await adjust(reloaded, { ...body, amount: 3 })).status, 400);
});

test("legacy state normalizes revisions and rejects stale edits after purchase", async () => {
  let stored = "";
  const oldState = seedState();
  delete oldState.revisions;
  delete (oldState.inventory[0] as Partial<InventoryItem>).revision;
  const api = new MockPantryApi(oldState, (state) => { stored = JSON.stringify(state); });
  const beforePurchaseRevision = api.state.inventory[0]!.revision;
  await api.fetch("/api/shopping-lists/20/items/21", {
    method: "PATCH", body: JSON.stringify({ purchased: true }),
  });
  const purchase = await api.fetch("/api/shopping-lists/20/purchase", { method: "POST" });
  assert.equal(purchase.status, 200);
  assert.equal(api.state.inventory[0]!.revision, beforePurchaseRevision + 1);
  assert.equal(api.state.inventory[0]!.quantity, 2);

  const stale = await api.fetch("/api/inventory/1", {
    method: "PATCH",
    body: JSON.stringify({ quantity: 99, revision: beforePurchaseRevision }),
  });
  assert.equal(stale.status, 409);
  assert.equal(api.state.inventory[0]!.quantity, 2);

  const reloaded = new MockPantryApi(JSON.parse(stored));
  assert.equal(reloaded.state.inventory[0]!.revision, beforePurchaseRevision + 1);
  assert.equal(reloaded.state.revisions?.[1], beforePurchaseRevision + 1);
});

test("demo reviewed list preserves quantities and exclusions through reload and purchase", async () => {
  let stored = "";
  const api = new MockPantryApi(undefined, state => { stored = JSON.stringify(state); });
  const response = await api.fetch("/api/suggestions/generate-list", {
    method: "POST",
    body: JSON.stringify({ items: [
      { inventoryItemId: 1, quantity: 7.5 },
      { inventoryItemId: 7, quantity: 0 },
    ] }),
  });
  assert.equal(response.status, 201);
  const list = await response.json();
  assert.deepEqual(list.items.map((item: { inventoryItemId: number; quantity: number }) =>
    ({ inventoryItemId: item.inventoryItemId, quantity: item.quantity })),
    [{ inventoryItemId: 1, quantity: 7.5 }]);
  const reloaded = new MockPantryApi(JSON.parse(stored));
  const persisted = await (await reloaded.fetch(`/api/shopping-lists/${list.id}`)).json();
  assert.deepEqual(persisted, list);
  const linkedItem = reloaded.state.lists.find((candidate) => candidate.id === list.id)!.items[0];
  assert.equal(linkedItem.inventoryItemId, 1);
  assert.equal(linkedItem.unit, reloaded.state.inventory.find((item) => item.id === 1)!.unit);
  const before = reloaded.state.inventory.map(item => item.quantity);
  assert.equal((await reloaded.fetch(`/api/shopping-lists/${list.id}/items/${list.items[0].id}`, {
    method: "PATCH", body: JSON.stringify({ purchased: true }),
  })).status, 200);
  for (const expected of [1, 0]) {
    const purchase = await reloaded.fetch(`/api/shopping-lists/${list.id}/purchase`, { method: "POST" });
    assert.equal((await purchase.json()).updatedInventoryItems, expected);
  }
  assert.deepEqual(reloaded.state.inventory.map(item => item.quantity),
    before.map((quantity, index) => index === 0 ? quantity + 7.5 : quantity));
  assert.equal(linkedItem.inventoryItemId, 1);
  assert.equal(linkedItem.unit, reloaded.state.inventory.find((item) => item.id === 1)!.unit);
});

test("demo reviewed list validates all selections before changing stored state", async () => {
  const api = new MockPantryApi();
  for (const items of [
    {}, [], [null], [{ inventoryItemId: 1, quantity: -1 }],
    [{ inventoryItemId: 1, quantity: "2" }],
    [{ inventoryItemId: 1.5, quantity: 2 }],
    [{ inventoryItemId: 1, quantity: 0 }],
    [{ inventoryItemId: 1, quantity: 2 }, { inventoryItemId: 999, quantity: 1 }],
    [{ inventoryItemId: 3, quantity: 1 }], // Expiry-only suggestion.
    [{ inventoryItemId: 6, quantity: 1 }], // Well-stocked item.
  ]) {
    const before = JSON.stringify(api.state);
    const response = await api.fetch("/api/suggestions/generate-list", {
      method: "POST", body: JSON.stringify({ items }),
    });
    assert.equal(response.status, 400, JSON.stringify(items));
    assert.equal(JSON.stringify(api.state), before);
  }
});

test("demo reviewed list combines duplicate selections", async () => {
  const api = new MockPantryApi();
  const response = await api.fetch("/api/suggestions/generate-list", {
    method: "POST", body: JSON.stringify({ items: [
      { inventoryItemId: 1, quantity: 1 }, { inventoryItemId: 1, quantity: 2.5 },
    ] }),
  });
  assert.equal(response.status, 201);
  const list = await response.json();
  assert.equal(list.items.length, 1);
  assert.equal(list.items[0].quantity, 3.5);
});

test("demo shortage to shopping to restock is repeat-safe and persists changes", async () => {
  let saved = false;
  const api = new MockPantryApi(undefined, () => {
    saved = true;
  });
  const call = async (path: string, method = "GET", body?: unknown) => {
    const response = await api.fetch(`/api/${path}`, {
      method,
      ...(body ? { body: JSON.stringify(body) } : {}),
    });
    assert.ok(response.ok);
    return response.status === 204 ? null : response.json();
  };
  const suggestions = await call("suggestions");
  assert.ok(
    suggestions.some((s: { urgency: string }) => s.urgency === "expiring_soon"),
  );
  const list = await call("suggestions/generate-list", "POST");
  assert.ok(list.items.length > 0);
  assert.ok(
    !list.items.some((i: { name: string }) => i.name === "Greek yogurt"),
  );
  const milk = list.items.find((i: { name: string }) => i.name === "Milk");
  await call(`shopping-lists/${list.id}/items/${milk.id}`, "PATCH", {
    purchased: true,
  });
  assert.equal(
    (await call(`shopping-lists/${list.id}/purchase`, "POST"))
      .updatedInventoryItems,
    1,
  );
  assert.equal(
    (await call(`shopping-lists/${list.id}/purchase`, "POST"))
      .updatedInventoryItems,
    0,
  );
  assert.equal((await call("inventory/1")).quantity, milk.quantity);
  assert.equal(saved, true);
  assert.equal(
    (
      await api.fetch(`/api/shopping-lists/20/items/${milk.id}`, {
        method: "PATCH",
        body: '{"purchased":true}',
      })
    ).status,
    404,
  );
  const item = await call("inventory", "POST", {
    name: "Tea",
    category: "Beverages",
    quantity: 3,
    minThreshold: 1,
    unit: "boxes",
  });
  await call(`inventory/${item.id}`, "PATCH", { quantity: 0, revision: item.revision });
  assert.ok(
    !(await call("inventory?category=Beverages&lowStock=true")).some(
      (i: { id: number }) => i.id === item.id,
    ),
  );
  assert.ok(
    (await call("inventory?category=Beverages&outOfStock=true")).some(
      (i: { id: number }) => i.id === item.id,
    ),
  );
  await call(`inventory/${item.id}`, "DELETE");
  assert.equal((await api.fetch(`/api/inventory/${item.id}`)).status, 404);
});
