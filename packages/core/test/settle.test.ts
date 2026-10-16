import { describe, expect, it } from 'vitest';
import { computeBalances } from '../src/balance';
import { computeExpense } from '../src/expense';
import { suggestTransfers, type Transfer } from '../src/settle';

const applyTransfers = (balances: Map<string, number>, transfers: Transfer[]) => {
  const next = new Map(balances);
  for (const t of transfers) {
    next.set(t.from, (next.get(t.from) ?? 0) + t.amountMinor);
    next.set(t.to, (next.get(t.to) ?? 0) - t.amountMinor);
  }
  return next;
};

describe('computeBalances', () => {
  it('nets paid minus owed, and sums to zero', () => {
    const e1 = computeExpense({
      currency: 'TWD',
      amountMinor: 900,
      fxRate: '1',
      baseCurrency: 'TWD',
      payers: [{ memberId: 'a', amountMinor: 900 }],
      split: { type: 'equal', memberIds: ['a', 'b', 'c'] },
    });
    const e2 = computeExpense({
      currency: 'JPY',
      amountMinor: 10000,
      fxRate: '0.2153',
      baseCurrency: 'TWD',
      payers: [{ memberId: 'b', amountMinor: 10000 }],
      split: { type: 'equal', memberIds: ['a', 'b', 'c'] },
    });
    const balances = computeBalances([e1, e2], []);
    // a: +900 -300 -718 = -118 ; b: +2153 -300 -718 = 1135 ; c: -300 -717 = -1017
    expect(Object.fromEntries(balances)).toEqual({ a: -118, b: 1135, c: -1017 });
    expect([...balances.values()].reduce((x, y) => x + y, 0)).toBe(0);
  });

  it('applies recorded settlements', () => {
    const e = computeExpense({
      currency: 'TWD',
      amountMinor: 200,
      fxRate: '1',
      baseCurrency: 'TWD',
      payers: [{ memberId: 'a', amountMinor: 200 }],
      split: { type: 'equal', memberIds: ['a', 'b'] },
    });
    const balances = computeBalances([e], [{ from: 'b', to: 'a', amountMinor: 100 }]);
    expect(Object.fromEntries(balances)).toEqual({ a: 0, b: 0 });
  });
});

describe('suggestTransfers', () => {
  it('returns nothing when everyone is settled', () => {
    expect(suggestTransfers(new Map([['a', 0], ['b', 0]]))).toEqual([]);
    expect(suggestTransfers(new Map())).toEqual([]);
  });

  it('settles a simple two-person debt', () => {
    expect(suggestTransfers(new Map([['a', 100], ['b', -100]]))).toEqual([
      { from: 'b', to: 'a', amountMinor: 100 },
    ]);
  });

  it('matches largest debtor with largest creditor', () => {
    const balances = new Map([
      ['a', -118],
      ['b', 1135],
      ['c', -1017],
    ]);
    expect(suggestTransfers(balances)).toEqual([
      { from: 'c', to: 'b', amountMinor: 1017 },
      { from: 'a', to: 'b', amountMinor: 118 },
    ]);
  });

  it('uses at most n-1 transfers and zeroes every balance', () => {
    const balances = new Map([
      ['a', 500],
      ['b', 300],
      ['c', -200],
      ['d', -250],
      ['e', -350],
    ]);
    const transfers = suggestTransfers(balances);
    expect(transfers.length).toBeLessThanOrEqual(balances.size - 1);
    expect(transfers.every((t) => t.amountMinor > 0)).toBe(true);
    for (const v of applyTransfers(balances, transfers).values()) expect(v).toBe(0);
  });

  it('is deterministic regardless of map insertion order', () => {
    const a = suggestTransfers(new Map([['x', 50], ['y', 50], ['z', -100]]));
    const b = suggestTransfers(new Map([['z', -100], ['y', 50], ['x', 50]]));
    expect(a).toEqual(b);
  });

  it('rejects balances that do not sum to zero', () => {
    expect(() => suggestTransfers(new Map([['a', 10]]))).toThrow(/sum to zero/i);
  });
});
