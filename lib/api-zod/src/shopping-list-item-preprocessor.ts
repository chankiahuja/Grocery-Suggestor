const boundaryWhitespace =
  /^[\u0009-\u000D\u0020\u00A0\u1680\u2000-\u200A\u2028\u2029\u202F\u205F\u3000\uFEFF]+|[\u0009-\u000D\u0020\u00A0\u1680\u2000-\u200A\u2028\u2029\u202F\u205F\u3000\uFEFF]+$/gu;
const unicodeNumber = /\p{Number}/u;
const unicodeLetter = /\p{Letter}/u;

export function isInvalidShoppingListUnit(value: string): boolean {
  const unit = value.replace(boundaryWhitespace, "");
  return unit.length === 0 || (unicodeNumber.test(unit) && !unicodeLetter.test(unit));
}

export function preprocessShoppingListItemBody(value: unknown): unknown {
  if (!value || typeof value !== "object" || Array.isArray(value)) return value;
  const body = value as Record<string, unknown>;
  if (typeof body.unit !== "string") return value;
  const unit = body.unit.replace(boundaryWhitespace, "");
  return { ...body, unit: isInvalidShoppingListUnit(unit) ? "" : unit };
}
