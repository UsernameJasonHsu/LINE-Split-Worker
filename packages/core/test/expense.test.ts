import { describe, expect, it } from 'vitest';
import { computeExpense } from '../src/expense';

describe('computeExpense', () => {
  it('splits a TWD expense equally', () => {
    const r = computeExpense({
      currency: 'TWD',
      amountMinor: 1000,
      fxRate: '1',
      baseCurrency: 'TWD',
      payers: [{ memberId: 'a', amountMinor: 1000 }],
      split: { type: 'equal', memberIds: ['a', 'b', 'c'] },
    });
    expect(r.baseAmountMinor).toBe(1000);
    expect(r.payers).toEqual([{ memberId: 'a', amountMinor: 1000, baseAmountMinor: 1000 }]);
    expect(r.shares).toEqual([
      { memberId: 'a', shareMinor: 334, baseShareMinor: 334 },
      { memberId: 'b', shareMinor: 333, baseShareMinor: 333 },
      { memberId: 'c', shareMinor: 333, baseShareMinor: 333 },
    ]);
  });

  it('splits a JPY expense and converts each share to TWD', () => {
    const r = computeExpense({
      currency: 'JPY',
      amountMinor: 10000,
      fxRate: '0.2153',
      baseCurrency: 'TWD',
      payers: [{ memberId: 'a', amountMinor: 10000 }],
      split: { type: 'equal', memberIds: ['a', 'b', 'c'] },
    });
    expect(r.baseAmountMinor).toBe(2153);
    expect(r.shares.map((s) => s.shareMinor)).toEqual([3334, 3333, 3333]);
    expect(r.shares.map((s) => s.baseShareMinor)).toEqual([718, 718, 717]);
  });

  it('supports multiple payers', () => {
    const r = computeExpense({
      currency: 'USD',
      amountMinor: 1001,
      fxRate: '32.5',
      baseCurrency: 'TWD',
      payers: [
        { memberId: 'a', amountMinor: 501 },
        { memberId: 'b', amountMinor: 500 },
      ],
      split: { type: 'equal', memberIds: ['a', 'b'] },
    });
    // $10.01 × 32.5 = 325.325 → 325
    expect(r.baseAmountMinor).toBe(325);
    expect(r.payers.reduce((s, p) => s + p.baseAmountMinor, 0)).toBe(325);
    expect(r.shares.reduce((s, p) => s + p.baseShareMinor, 0)).toBe(325);
  });

  it('supports weighted split (shares / ratio)', () => {
    const r = computeExpense({
      currency: 'TWD',
      amountMinor: 900,
      fxRate: '1',
      baseCurrency: 'TWD',
      payers: [{ memberId: 'a', amountMinor: 900 }],
      split: {
        type: 'weights',
        items: [
          { memberId: 'a', weight: 2 },
          { memberId: 'b', weight: 1 },
        ],
      },
    });
    expect(r.shares.map((s) => s.shareMinor)).toEqual([600, 300]);
  });

  it('supports exact split', () => {
    const r = computeExpense({
      currency: 'TWD',
      amountMinor: 500,
      fxRate: '1',
      baseCurrency: 'TWD',
      payers: [{ memberId: 'a', amountMinor: 500 }],
      split: {
        type: 'exact',
        items: [
          { memberId: 'a', amountMinor: 120 },
          { memberId: 'b', amountMinor: 380 },
        ],
      },
    });
    expect(r.shares.map((s) => s.shareMinor)).toEqual([120, 380]);
  });

  describe('fixed amounts with the rest split equally', () => {
    const base = {
      currency: 'TWD',
      amountMinor: 12000,
      fxRate: '1',
      baseCurrency: 'TWD',
      payers: [{ memberId: 'a', amountMinor: 12000 }],
    };

    it('gives fixed members their amount and splits the rest', () => {
      const r = computeExpense({
        ...base,
        split: { type: 'fixed_rest', fixed: [{ memberId: 'a', amountMinor: 5000 }], restMemberIds: ['b', 'c', 'd'] },
      });
      expect(r.shares.map((s) => [s.memberId, s.shareMinor])).toEqual([
        ['a', 5000],
        ['b', 2334],
        ['c', 2333],
        ['d', 2333],
      ]);
    });

    it('lets a member have a fixed amount and also share the rest', () => {
      const r = computeExpense({
        ...base,
        split: { type: 'fixed_rest', fixed: [{ memberId: 'a', amountMinor: 2000 }], restMemberIds: ['a', 'b'] },
      });
      // rest 10000 → 5000 each; a = 2000 + 5000
      expect(r.shares.map((s) => [s.memberId, s.shareMinor])).toEqual([
        ['a', 7000],
        ['b', 5000],
      ]);
    });

    it('allows fixed amounts that use up the whole total', () => {
      const r = computeExpense({
        ...base,
        split: {
          type: 'fixed_rest',
          fixed: [
            { memberId: 'a', amountMinor: 7000 },
            { memberId: 'b', amountMinor: 5000 },
          ],
          restMemberIds: [],
        },
      });
      expect(r.shares.map((s) => s.shareMinor)).toEqual([7000, 5000]);
    });

    it('converts to the base currency without losing a unit', () => {
      const r = computeExpense({
        currency: 'JPY',
        amountMinor: 10000,
        fxRate: '0.2153',
        baseCurrency: 'TWD',
        payers: [{ memberId: 'a', amountMinor: 10000 }],
        split: { type: 'fixed_rest', fixed: [{ memberId: 'a', amountMinor: 4000 }], restMemberIds: ['b', 'c'] },
      });
      expect(r.shares.map((s) => s.shareMinor)).toEqual([4000, 3000, 3000]);
      expect(r.shares.reduce((s, x) => s + x.baseShareMinor, 0)).toBe(r.baseAmountMinor);
    });

    it('rejects fixed amounts above the total, a rest nobody shares, and duplicates', () => {
      const split = (fixed: { memberId: string; amountMinor: number }[], restMemberIds: string[]) => () =>
        computeExpense({ ...base, split: { type: 'fixed_rest', fixed, restMemberIds } });
      expect(split([{ memberId: 'a', amountMinor: 12001 }], ['b'])).toThrow(/exceed/i);
      expect(split([{ memberId: 'a', amountMinor: 5000 }], [])).toThrow(/remaining/i);
      expect(split([], [])).toThrow();
      expect(split([{ memberId: 'a', amountMinor: 1 }, { memberId: 'a', amountMinor: 2 }], ['b'])).toThrow(/duplicate/i);
      expect(split([{ memberId: 'a', amountMinor: -1 }], ['b'])).toThrow();
    });
  });

  it('rejects payers that do not sum to the amount', () => {
    expect(() =>
      computeExpense({
        currency: 'TWD',
        amountMinor: 500,
        fxRate: '1',
        baseCurrency: 'TWD',
        payers: [{ memberId: 'a', amountMinor: 400 }],
        split: { type: 'equal', memberIds: ['a'] },
      }),
    ).toThrow(/payers/i);
  });

  it('rejects exact split that does not sum to the amount', () => {
    expect(() =>
      computeExpense({
        currency: 'TWD',
        amountMinor: 500,
        fxRate: '1',
        baseCurrency: 'TWD',
        payers: [{ memberId: 'a', amountMinor: 500 }],
        split: { type: 'exact', items: [{ memberId: 'a', amountMinor: 499 }] },
      }),
    ).toThrow(/split/i);
  });

  it('rejects non-positive amounts, empty or duplicate members', () => {
    const base = {
      currency: 'TWD',
      fxRate: '1',
      baseCurrency: 'TWD',
    } as const;
    expect(() =>
      computeExpense({
        ...base,
        amountMinor: 0,
        payers: [{ memberId: 'a', amountMinor: 0 }],
        split: { type: 'equal', memberIds: ['a'] },
      }),
    ).toThrow();
    expect(() =>
      computeExpense({
        ...base,
        amountMinor: 10,
        payers: [{ memberId: 'a', amountMinor: 10 }],
        split: { type: 'equal', memberIds: [] },
      }),
    ).toThrow();
    expect(() =>
      computeExpense({
        ...base,
        amountMinor: 10,
        payers: [{ memberId: 'a', amountMinor: 10 }],
        split: { type: 'equal', memberIds: ['a', 'a'] },
      }),
    ).toThrow(/duplicate/i);
  });
});
