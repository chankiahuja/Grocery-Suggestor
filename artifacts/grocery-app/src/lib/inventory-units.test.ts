import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { displayUnit, formatQuantity, isInvalidUnit } from "./inventory-units";

describe("inventory unit policy", () => {
  it("rejects blank and numeric-only values but keeps custom text", () => {
    assert.equal(isInvalidUnit(""), true);
    assert.equal(isInvalidUnit("  2.5  "), true);
    assert.equal(isInvalidUnit("٢"), true);
    assert.equal(isInvalidUnit("²"), true);
    assert.equal(isInvalidUnit("Ⅳ"), true);
    assert.equal(isInvalidUnit("\u00a0\u00a0"), true);
    assert.equal(isInvalidUnit("\u20032\u2003"), true);
    assert.equal(isInvalidUnit("bags"), false);
    assert.equal(isInvalidUnit("kg / g"), false);
  });

  it("pluralizes supported presets without rewriting custom units", () => {
    assert.equal(displayUnit(1, "piece"), "piece");
    assert.equal(displayUnit(2, "piece"), "pieces");
    assert.equal(displayUnit(2, "box"), "boxes");
    assert.equal(displayUnit(2, "bags"), "bags");
    assert.equal(displayUnit(2, "constructor"), "constructor");
    assert.equal(formatQuantity(2, "2"), "2 (unit needs correction)");
  });
});
