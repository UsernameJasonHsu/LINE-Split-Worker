import type { ExpenseCategory } from '@line-split/core';
import type { Expense } from '../api';

export type FilterScope = 'all' | 'mine' | 'paidByMe';

export interface ExpenseFilter {
  query: string;
  scope: FilterScope;
  /** A category key, 'none' for uncategorised, or 'all'. */
  category: ExpenseCategory | 'none' | 'all';
}

export const DEFAULT_FILTER: ExpenseFilter = { query: '', scope: 'all', category: 'all' };

export const isFilterActive = (f: ExpenseFilter) =>
  f.query.trim() !== '' || f.scope !== 'all' || f.category !== 'all';

export function filterExpenses(expenses: Expense[], f: ExpenseFilter, meId: string): Expense[] {
  const query = f.query.trim().toLowerCase();
  return expenses.filter((e) => {
    const paid = e.payers.some((p) => p.memberId === meId);
    if (f.scope === 'paidByMe' && !paid) return false;
    if (f.scope === 'mine' && !paid && !e.shares.some((s) => s.memberId === meId)) return false;
    if (f.category === 'none' ? e.category !== null : f.category !== 'all' && e.category !== f.category) return false;
    return query === '' || e.title.toLowerCase().includes(query);
  });
}
