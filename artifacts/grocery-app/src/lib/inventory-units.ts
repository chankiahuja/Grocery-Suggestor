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

const NUMERIC_ONLY_UNIT = /^[+-]?(?:\d+(?:\.\d*)?|\.\d+)$/;

export function isInvalidUnit(value: string): boolean {
  const unit = value.trim();
  return unit.length === 0 || NUMERIC_ONLY_UNIT.test(unit);
}

const PLURAL_UNITS: Record<string, string> = {
  piece: "pieces",
  pack: "packs",
  box: "boxes",
  bottle: "bottles",
  can: "cans",
  lb: "lbs",
  oz: "oz",
};

export function displayUnit(quantity: number, unit: string): string {
  const trimmed = unit.trim();
  return quantity === 1 ? trimmed : (PLURAL_UNITS[trimmed] ?? trimmed);
}

export function formatQuantity(quantity: number, unit: string): string {
  return isInvalidUnit(unit)
    ? `${quantity} (unit needs correction)`
    : `${quantity} ${displayUnit(quantity, unit)}`;
}
