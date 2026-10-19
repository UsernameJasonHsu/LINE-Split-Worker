import { computeExpense } from '@line-split/core';
import { describe, expect, it } from 'vitest';
import { expenseNotice, guessCategory, pastTitles } from '../src/lib/suggest';

const past = [
  { title: '晚餐', category: 'food', createdAt: 1 },
  { title: '全家', category: 'food', createdAt: 2 },
  { title: ' 晚餐 ', category: null, createdAt: 3 },
  { title: '計程車', category: 'transport', createdAt: 4 },
];

describe('pastTitles', () => {
  it('lists distinct titles, newest first', () => {
    expect(pastTitles(past)).toEqual(['計程車', '晚餐', '全家']);
    expect(pastTitles(past, 1)).toEqual(['計程車']);
  });
});

describe('guessCategory', () => {
  it('prefers how the group categorised the same title before', () => {
    expect(guessCategory('全家', past)).toBe('food'); // keyword list would say shopping
    expect(guessCategory('晚餐', past)).toBe('food');
  });

  it('falls back to keywords, with lodging and transport checked first', () => {
    expect(guessCategory('飯店', [])).toBe('lodging');
    expect(guessCategory('機票', [])).toBe('transport');
    expect(guessCategory('一蘭拉麵', [])).toBe('food');
    expect(guessCategory('迪士尼門票', [])).toBe('fun');
    expect(guessCategory('Costco', [])).toBe('shopping');
    expect(guessCategory('雜項', [])).toBeNull();
    expect(guessCategory('  ', past)).toBeNull();
  });
});

describe('expenseNotice', () => {
  const names: Record<string, string> = { a: 'Alice', b: 'Bob', c: 'Carol' };
  const nameOf = (id: string) => names[id]!;
  const base = { currency: 'TWD', fxRate: '1', baseCurrency: 'TWD' };

  it('summarises an equal split with the per-person amount', () => {
    const computed = computeExpense({
      ...base,
      amountMinor: 1200,
      payers: [{ memberId: 'a', amountMinor: 1200 }],
      split: { type: 'equal', memberIds: ['a', 'b', 'c'] },
    });
    expect(expenseNotice('晚餐 ', computed, nameOf, 'https://x')).toBe(
      '🧾 「晚餐」TWD 1,200\nAlice 付款，3 人均分，每人 TWD 400\n查看帳本：https://x',
    );
  });

  it('lists each share when they differ', () => {
    const computed = computeExpense({
      ...base,
      amountMinor: 1000,
      payers: [{ memberId: 'a', amountMinor: 1000 }],
      split: { type: 'exact', items: [{ memberId: 'a', amountMinor: 700 }, { memberId: 'b', amountMinor: 300 }] },
    });
    expect(expenseNotice('房租', computed, nameOf, 'https://x')).toContain('2 人分攤：Alice TWD 700、Bob TWD 300');
  });
});
