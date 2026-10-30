import assert from "node:assert/strict";
import { test } from "node:test";
import { MockPantryApi } from "./pantry-api";

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
