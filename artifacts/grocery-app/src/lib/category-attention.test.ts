import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import type { InventoryItem } from '@workspace/api-client-react';
import { getCategoryAttention, isExpiringSoon, isExpired } from './category-attention';

const today = '2026-01-01';
const now = new Date(`${today}T12:00:00.000Z`);

function item(
  id: number,
  category: string,
  quantity: number,
  minThreshold: number,
  expiresAt: string | null = null
): InventoryItem {
  return {
    id,
    name: `Item ${id}`,
    category,
    quantity,
    unit: 'each',
    minThreshold,
    expiresAt,
    notes: null,
    createdAt: `${today}T00:00:00.000Z`,
    updatedAt: `${today}T00:00:00.000Z`,
  };
}

describe('isExpiringSoon', () => {
  it('includes today and the seventh day, but excludes dates outside that window', () => {
    assert.equal(isExpiringSoon('2026-01-01', now), true);
    assert.equal(isExpiringSoon('2026-01-08', now), true);
    assert.equal(isExpiringSoon('2025-12-31', now), false);
    assert.equal(isExpiringSoon('2026-01-09', now), false);
  });

  it('returns false when no expiry date is present', () => {
    assert.equal(isExpiringSoon(null, now), false);
    assert.equal(isExpiringSoon(undefined, now), false);
  });
});

describe('getCategoryAttention', () => {
  it('counts conditions once and orders categories by expiry priority before low stock', () => {
    const result = getCategoryAttention(
      [
        item(1, 'Out', 0, 2, '2026-01-03'),
        item(2, 'Mixed', 1, 2, '2026-01-08'),
        item(3, 'Low Alpha', 1, 2),
        item(4, 'Low Beta', 1, 2),
        item(5, 'Expiry', 3, 1, '2026-01-01'),
        item(6, 'Healthy', 4, 1),
        item(7, 'Beyond Window', 4, 1, '2026-01-09'),
        item(8, 'Past Expiry', 4, 1, '2025-12-31'),
      ],
      now
    );

    assert.deepEqual(result, [
      { category: 'Past Expiry', attentionItems: 1, outOfStock: 0, lowStock: 0, expiringSoon: 0, expired: 1 },
      {
        category: 'Out',
        attentionItems: 1,
        outOfStock: 1,
        lowStock: 0,
        expiringSoon: 0,
        expired: 0,
      },
      {
        category: 'Expiry',
        attentionItems: 1,
        outOfStock: 0,
        lowStock: 0,
        expiringSoon: 1,
        expired: 0,
      },
      {
        category: 'Mixed',
        attentionItems: 1,
        outOfStock: 0,
        lowStock: 1,
        expiringSoon: 1,
        expired: 0,
      },
      {
        category: 'Low Alpha',
        attentionItems: 1,
        outOfStock: 0,
        lowStock: 1,
        expiringSoon: 0,
        expired: 0,
      },
      {
        category: 'Low Beta',
        attentionItems: 1,
        outOfStock: 0,
        lowStock: 1,
        expiringSoon: 0,
        expired: 0,
      },
    ]);
  });

  it('returns no category cards for empty or fully healthy inventory', () => {
    assert.deepEqual(getCategoryAttention([], now), []);
    assert.deepEqual(
      getCategoryAttention(
        [
          item(1, 'Healthy', 4, 1),
          item(2, 'Not Yet Expiring', 3, 1, '2026-01-09'),

        ],
        now
      ),
      []
    );
  });
});


describe('expired attention', () => {
  it('uses UTC date boundaries and excludes today from expired status', () => {
    const boundary = new Date('2026-01-02T00:30:00+05:30');
    assert.equal(isExpired('2025-12-31', boundary), true);
    assert.equal(isExpired('2026-01-01', boundary), false);
    assert.equal(isExpired(null, boundary), false);
  });
  it('counts overlapping expired and low stock once and ignores empty expired stock', () => {
    assert.deepEqual(getCategoryAttention([
      item(1, 'Dairy', 1, 2, '2025-12-31'),
      item(2, 'Dairy', 0, 2, '2025-12-31'),
    ], now), [{ category: 'Dairy', attentionItems: 2, outOfStock: 1, lowStock: 1, expiringSoon: 0, expired: 1 }]);
  });
});
