import type { ComputedExpense } from './expense';

/** A recorded repayment, in the ledger's base currency. */
export interface Settlement {
  from: string;
  to: string;
  amountMinor: number;
}

/**
 * Net balance per member in base-currency minor units.
 * Positive: the member is owed money. Negative: the member owes money.
 */
export function computeBalances(
  expenses: Pick<ComputedExpense, 'payers' | 'shares'>[],
  settlements: Settlement[],
): Map<string, number> {
  const balances = new Map<string, number>();
  const add = (id: string, delta: number) => balances.set(id, (balances.get(id) ?? 0) + delta);

  for (const e of expenses) {
    for (const p of e.payers) add(p.memberId, p.baseAmountMinor);
    for (const s of e.shares) add(s.memberId, -s.baseShareMinor);
  }
  for (const s of settlements) {
    add(s.from, s.amountMinor);
    add(s.to, -s.amountMinor);
  }
  return balances;
}
