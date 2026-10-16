import type { Expense, Member } from '../api';

export interface CategoryTotal {
  category: string | null;
  totalMinor: number;
  count: number;
  /** Share of the ledger total, 0–1. */
  ratio: number;
}

export interface MemberTotal {
  memberId: string;
  /** What the member consumed (their shares). */
  spentMinor: number;
  /** What the member paid up front. */
  paidMinor: number;
}

/** Ledger statistics in base-currency minor units. */
export function computeStats(expenses: Expense[], members: Member[]) {
  const totalMinor = expenses.reduce((s, e) => s + e.baseAmountMinor, 0);

  const categories = new Map<string | null, { totalMinor: number; count: number }>();
  for (const e of expenses) {
    const c = categories.get(e.category) ?? { totalMinor: 0, count: 0 };
    c.totalMinor += e.baseAmountMinor;
    c.count += 1;
    categories.set(e.category, c);
  }
  const byCategory: CategoryTotal[] = [...categories]
    .map(([category, c]) => ({ category, ...c, ratio: totalMinor ? c.totalMinor / totalMinor : 0 }))
    .filter((c) => c.totalMinor > 0)
    .sort((a, b) => b.totalMinor - a.totalMinor);

  const byId = new Map<string, MemberTotal>(members.map((m) => [m.id, { memberId: m.id, spentMinor: 0, paidMinor: 0 }]));
  const totalFor = (id: string) => {
    let t = byId.get(id);
    if (!t) byId.set(id, (t = { memberId: id, spentMinor: 0, paidMinor: 0 }));
    return t;
  };
  for (const e of expenses) {
    for (const s of e.shares) totalFor(s.memberId).spentMinor += s.baseShareMinor;
    for (const p of e.payers) totalFor(p.memberId).paidMinor += p.baseAmountMinor;
  }
  const byMember = [...byId.values()].sort((a, b) => b.spentMinor - a.spentMinor);

  return { totalMinor, byCategory, byMember };
}
