import assert from "node:assert/strict";
import { test } from "node:test";
import {
  shoppingListNameCodePointLength,
  shoppingListNameError,
  trimShoppingListBoundaryWhitespace,
} from "./shopping-list-name";

const boundaryWhitespace = [
  "\u0009", "\u000a", "\u000b", "\u000c", "\u000d", "\u0020",
  "\u00a0", "\u1680", "\u2000", "\u2001", "\u2002", "\u2003",
  "\u2004", "\u2005", "\u2006", "\u2007", "\u2008", "\u2009",
  "\u200a", "\u2028", "\u2029", "\u202f", "\u205f", "\u3000", "\ufeff",
];

test("shopping-list names use the documented boundary whitespace table", () => {
  for (const whitespace of boundaryWhitespace) {
    assert.equal(trimShoppingListBoundaryWhitespace(`${whitespace}List${whitespace}`), "List");
    assert.equal(shoppingListNameError(whitespace), "Name is required");
  }
  assert.equal(trimShoppingListBoundaryWhitespace("  Weekly\u00a0 shop  "), "Weekly\u00a0 shop");
});

test("shopping-list name limits count Unicode code points", () => {
  assert.equal(shoppingListNameCodePointLength("😀"), 1);
  assert.equal(shoppingListNameError("😀".repeat(100)), undefined);
  assert.equal(shoppingListNameError("a".repeat(100)), undefined);
  assert.equal(shoppingListNameError("😀".repeat(101)), "Name must be 100 Unicode code points or fewer");
  assert.equal(shoppingListNameError("a".repeat(101)), "Name must be 100 Unicode code points or fewer");
});
