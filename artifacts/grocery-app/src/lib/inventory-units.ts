export const INVENTORY_UNIT_OPTIONS = [
  "piece",
  "pack",
  "box",
  "bottle",
  "can",
  "kg",
  "g",
  "L",
  "mL",
  "lb",
  "oz",
] as const;

const NUMERIC_UNIT_CHARACTERS = /^[+\-.\p{Number}]+$/u;
const NUMERIC_UNIT_DIGIT = /\p{Number}/u;

function trimUnit(value: string): string {
  return value.replace(/^[\s\p{Z}]+|[\s\p{Z}]+$/gu, "");
}

export function isInvalidUnit(value: string): boolean {
  const unit = trimUnit(value);
  return unit.length === 0 || (NUMERIC_UNIT_CHARACTERS.test(unit) && NUMERIC_UNIT_DIGIT.test(unit));
}

const PLURAL_UNITS = new Map([
  ["piece", "pieces"],
  ["pack", "packs"],
  ["box", "boxes"],
  ["bottle", "bottles"],
  ["can", "cans"],
  ["lb", "lbs"],
  ["oz", "oz"],
]);

export function displayUnit(quantity: number, unit: string): string {
  const trimmed = trimUnit(unit);
  return quantity === 1 ? trimmed : (PLURAL_UNITS.get(trimmed) ?? trimmed);
}

export function formatQuantity(quantity: number, unit: string): string {
  return isInvalidUnit(unit)
    ? `${quantity} (unit needs correction)`
    : `${quantity} ${displayUnit(quantity, unit)}`;
}
