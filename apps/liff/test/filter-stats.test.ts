import { describe, expect, it } from 'vitest';
import type { Expense, Member } from '../src/api';
import { filterExpenses, isFilterActive, type ExpenseFilter } from '../src/lib/filter';
import { computeStats } from '../src/lib/stats';

const members: Member[] = ['a', 'b', 'c'].map((id) => ({
  id,
  displayName: id.toUpperCase(),
  avatarUrl: null,
  isVirtual: false,
  paymentInfo: null,
}));

function expense(
  id: string,
  title: string,
  category: string | null,
  payers: [string, number][],
  shares: [string, number][],
): Expense {
  const total = payers.reduce((s, [, v]) => s + v, 0);
  return {
    id,
    title,
    category,
    note: null,
    currency: 'TWD',
    amountMinor: total,
    fxRate: '1',
    fxSource: 'NONE',
    baseAmountMinor: total,
    splitType: 'exact',
    spentAt: 0,
    createdBy: 'a',
    createdAt: 0,
    updatedAt: 0,
    revision: 'r',
    payers: payers.map(([memberId, v]) => ({ memberId, amountMinor: v, baseAmountMinor: v })),
    shares: shares.map(([memberId, v]) => ({ memberId, splitValue: v, shareMinor: v, baseShareMinor: v })),
  };
}

const expenses = [
  expense('1', '拉麵', 'food', [['a', 900]], [['a', 300], ['b', 300], ['c', 300]]),
  expense('2', 'Taxi to hotel', 'transport', [['b', 400]], [['b', 200], ['c', 200]]),
  expense('3', '飯店', 'lodging', [['a', 6000], ['c', 3000]], [['a', 3000], ['b', 3000], ['c', 3000]]),
  expense('4', '咖啡', null, [['c', 150]], [['c', 150]]),
  expense('5', '燒肉', 'food', [['b', 1200]], [['a', 600], ['b', 600]]),
];

const all: ExpenseFilter = { query: '', scope: 'all', category: 'all' };
const ids = (list: Expense[]) => list.map((e) => e.id);

describe('filterExpenses', () => {
  it('returns everything with the default filter', () => {
    expect(ids(filterExpenses(expenses, all, 'a'))).toEqual(['1', '2', '3', '4', '5']);
    expect(isFilterActive(all)).toBe(false);
  });

  it('filters by scope', () => {
    // "involves me": I paid or I have a share
    expect(ids(filterExpenses(expenses, { ...all, scope: 'mine' }, 'a'))).toEqual(['1', '3', '5']);
    expect(ids(filterExpenses(expenses, { ...all, scope: 'paidByMe' }, 'c'))).toEqual(['3', '4']);
  });

  it('filters by category, including uncategorised', () => {
    expect(ids(filterExpenses(expenses, { ...all, category: 'food' }, 'a'))).toEqual(['1', '5']);
    expect(ids(filterExpenses(expenses, { ...all, category: 'none' }, 'a'))).toEqual(['4']);
  });

  it('also searches notes', () => {
    const withNote = [...expenses, { ...expenses[0]!, id: '6', title: '晚餐', note: '含 Service charge' }];
    expect(ids(filterExpenses(withNote, { ...all, query: 'service' }, 'a'))).toEqual(['6']);
  });

  it('searches titles case-insensitively and combines filters', () => {
    expect(ids(filterExpenses(expenses, { ...all, query: ' taxi ' }, 'a'))).toEqual(['2']);
    expect(ids(filterExpenses(expenses, { query: '麵', scope: 'mine', category: 'food' }, 'b'))).toEqual(['1']);
    expect(isFilterActive({ ...all, query: 'x' })).toBe(true);
  });
});

describe('computeStats', () => {
  const stats = computeStats(expenses, members);

  it('totals by category, largest first, with ratios', () => {
    expect(stats.totalMinor).toBe(900 + 400 + 9000 + 150 + 1200);
    expect(stats.byCategory.map((c) => [c.category, c.totalMinor, c.count])).toEqual([
      ['lodging', 9000, 1],
      ['food', 2100, 2],
      ['transport', 400, 1],
      [null, 150, 1],
    ]);
    expect(stats.byCategory.reduce((s, c) => s + c.ratio, 0)).toBeCloseTo(1);
  });

  it('reports what each member consumed and fronted', () => {
    expect(stats.byMember).toEqual([
      { memberId: 'b', spentMinor: 4100, paidMinor: 1600 },
      { memberId: 'a', spentMinor: 3900, paidMinor: 6900 },
      { memberId: 'c', spentMinor: 3650, paidMinor: 3150 },
    ]);
  });

  it('handles an empty ledger', () => {
    const empty = computeStats([], members);
    expect(empty).toMatchObject({ totalMinor: 0, byCategory: [] });
    expect(empty.byMember.every((m) => m.spentMinor === 0 && m.paidMinor === 0)).toBe(true);
  });
});
