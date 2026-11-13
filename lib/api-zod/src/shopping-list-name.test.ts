import assert from "node:assert/strict";
import { test } from "node:test";
import { CreateShoppingListBody, UpdateShoppingListBody } from "./index";

for (const [label, schema] of [
  ["create", CreateShoppingListBody],
  ["rename", UpdateShoppingListBody],
] as const) {
  test(`${label} shopping-list schema enforces the normalized Unicode name contract`, () => {
    const emoji = String.fromCodePoint(0x1f600);
    assert.equal(schema.parse({ name: emoji.repeat(100) }).name, emoji.repeat(100));
    assert.equal(schema.safeParse({ name: emoji.repeat(101) }).success, false);
    assert.equal(schema.safeParse({ name: "\uFEFF\u00A0\u3000" }).success, false);
    assert.equal(
      schema.parse({ name: "\uFEFF Weekly\u00A0 shop \u3000" }).name,
      "Weekly\u00A0 shop",
    );
  });
}
