export const SHOPPING_LIST_NAME_MAX_CODE_POINTS = 100;

// Keep this table identical to PantryService.isShoppingListBoundaryWhitespace.
export function isShoppingListBoundaryWhitespace(codePoint: number): boolean {
  return (
    codePoint === 0x0009 ||
    codePoint === 0x000a ||
    codePoint === 0x000b ||
    codePoint === 0x000c ||
    codePoint === 0x000d ||
    codePoint === 0x0020 ||
    codePoint === 0x00a0 ||
    codePoint === 0x1680 ||
    (codePoint >= 0x2000 && codePoint <= 0x200a) ||
    codePoint === 0x2028 ||
    codePoint === 0x2029 ||
    codePoint === 0x202f ||
    codePoint === 0x205f ||
    codePoint === 0x3000 ||
    codePoint === 0xfeff
  );
}

export function trimShoppingListBoundaryWhitespace(value: string): string {
  const codePoints = Array.from(value);
  let start = 0;
  let end = codePoints.length;
  while (
    start < end &&
    isShoppingListBoundaryWhitespace(codePoints[start].codePointAt(0)!)
  ) {
    start += 1;
  }
  while (
    end > start &&
    isShoppingListBoundaryWhitespace(codePoints[end - 1].codePointAt(0)!)
  ) {
    end -= 1;
  }
  return codePoints.slice(start, end).join("");
}

export function shoppingListNameCodePointLength(value: string): number {
  return Array.from(value).length;
}

export function shoppingListNameError(value: string): string | undefined {
  const normalized = trimShoppingListBoundaryWhitespace(value);
  if (!normalized) return "Name is required";
  if (
    shoppingListNameCodePointLength(normalized) >
    SHOPPING_LIST_NAME_MAX_CODE_POINTS
  ) {
    return "Name must be 100 Unicode code points or fewer";
  }
  return undefined;
}
