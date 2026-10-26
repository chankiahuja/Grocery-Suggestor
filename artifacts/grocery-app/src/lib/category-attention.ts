import type { InventoryItem } from '@workspace/api-client-react';

export type CategoryAttention = {
  category: string;
  attentionItems: number;
  outOfStock: number;
  lowStock: number;
  expiringSoon: number;
};

export function isExpiringSoon(
  expiresAt: string | null | undefined,
  now = new Date()
): boolean {
  const expirationDate = expiresAt?.slice(0, 10);
  if (!expirationDate) return false;

  const today = now.toISOString().slice(0, 10);
  const sevenDaysFromNow = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000)
    .toISOString()
    .slice(0, 10);

  return expirationDate >= today && expirationDate <= sevenDaysFromNow;
}

export function getCategoryAttention(
  items: InventoryItem[],
  now = new Date()
): CategoryAttention[] {
  const grouped = new Map<string, CategoryAttention>();

  for (const item of items) {
    let category = grouped.get(item.category);
    if (!category) {
      category = {
        category: item.category,
        attentionItems: 0,
        outOfStock: 0,
        lowStock: 0,
        expiringSoon: 0,
      };
      grouped.set(item.category, category);
    }

    const isOutOfStock = item.quantity === 0;
    const isLowStock = !isOutOfStock && item.quantity <= item.minThreshold;
    const expiringSoon = isExpiringSoon(item.expiresAt, now);

    if (isOutOfStock) {
      category.outOfStock += 1;
    } else if (isLowStock) {
      category.lowStock += 1;
    }

    if (expiringSoon) category.expiringSoon += 1;
    if (isOutOfStock || isLowStock || expiringSoon) {
      category.attentionItems += 1;
    }
  }

  return Array.from(grouped.values())
    .filter((category) => category.attentionItems > 0)
    .sort(
      (a, b) =>
        b.outOfStock - a.outOfStock ||
        b.lowStock - a.lowStock ||
        b.expiringSoon - a.expiringSoon ||
        a.category.localeCompare(b.category)
    );
}
