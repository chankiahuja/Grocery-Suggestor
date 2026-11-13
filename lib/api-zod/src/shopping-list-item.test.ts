import assert from "node:assert/strict";
import { test } from "node:test";
import { AddShoppingListItemBody, UpdateShoppingListItemBody } from "./index";

for (const [label, schema] of [
  ["create", AddShoppingListItemBody],
  ["update", UpdateShoppingListItemBody],
] as const) {
  test(`${label} shopping-item schema trims and counts Unicode unit code points`, () => {
    const emoji = String.fromCodePoint(0x1f600);
    const valid = `${"\u00A0"}${emoji.repeat(64)}\u3000`;
    assert.equal(schema.parse(label === "create"
      ? { name: "Rice", category: "Pantry", quantity: 1, unit: valid }
      : { unit: valid }).unit, emoji.repeat(64));
    assert.equal(schema.safeParse(label === "create"
      ? { name: "Rice", category: "Pantry", quantity: 1, unit: emoji.repeat(65) }
      : { unit: emoji.repeat(65) }).success, false);
    assert.equal(schema.safeParse(label === "create"
      ? { name: "Rice", category: "Pantry", quantity: 1, unit: "   " }
      : { unit: "   " }).success, false);
    assert.equal(schema.safeParse(label === "create"
      ? { name: "Rice", category: "Pantry", quantity: 1, unit: "123" }
      : { unit: "123" }).success, false);
    assert.equal(schema.parse(label === "create"
      ? { name: "Rice", category: "Pantry", quantity: 1, unit: "  grams per item  " }
      : { unit: "  grams per item  " }).unit, "grams per item");
  });
}
