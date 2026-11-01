import assert from "node:assert/strict";
import { test } from "node:test";
import { MockPantryApi, seedState } from "./pantry-api";

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
      for (const quantity of [2, 1]) await api.fetch("/api/inventory/1", { method: "PATCH", body: JSON.stringify({ quantity }) });
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
  assert.deepEqual(item, { ...original, quantity: 2.5, updatedAt: item.updatedAt });
  const restocked = await adjust(api, { operation: "restock", amount: 0.5 }, "restock");
  assert.equal(restocked.status, 200);
  assert.equal((await restocked.json()).quantity, 3);
  const emptied = await adjust(api, { operation: "consume", amount: 3 }, "empty");
  assert.equal(emptied.status, 200);
  assert.equal((await emptied.json()).quantity, 0);
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
    method: "PATCH", body: JSON.stringify({ quantity: 0, notes: "Changed later" }),
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
  assert.equal(oldState.adjustments, undefined);
  let stored = JSON.stringify(oldState);
  const api = new MockPantryApi(JSON.parse(stored), (state) => {
    stored = JSON.stringify(state);
  });
  const body = { operation: "restock", amount: 2 };
  assert.equal((await adjust(api, body)).status, 200);
  let replaySaves = 0;
  const reloaded = new MockPantryApi(JSON.parse(stored), () => replaySaves++);
  const replay = await adjust(reloaded, body);
  assert.equal(replay.status, 200);
  assert.equal((await replay.json()).quantity, 6);
  assert.equal(replaySaves, 0);
  assert.equal((await adjust(reloaded, { ...body, amount: 3 })).status, 400);
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
  await call(`inventory/${item.id}`, "PATCH", { quantity: 0 });
  assert.ok(
    (await call("inventory?category=Beverages&lowStock=true")).some(
      (i: { id: number }) => i.id === item.id,
    ),
  );
  await call(`inventory/${item.id}`, "DELETE");
  assert.equal((await api.fetch(`/api/inventory/${item.id}`)).status, 404);
});
