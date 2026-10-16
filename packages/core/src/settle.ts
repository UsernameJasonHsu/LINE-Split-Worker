export interface Transfer {
  from: string;
  to: string;
  amountMinor: number;
}

interface Entry {
  id: string;
  amount: number;
}

const byAmountDescThenId = (a: Entry, b: Entry) =>
  b.amount - a.amount || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);

/**
 * Greedy debt simplification: repeatedly match the largest debtor with the
 * largest creditor. Produces at most n-1 transfers; ties are broken by member
 * id so the result does not depend on map order.
 */
export function suggestTransfers(balances: Map<string, number>): Transfer[] {
  let total = 0;
  for (const v of balances.values()) total += v;
  if (total !== 0) throw new Error(`Balances must sum to zero, got ${total}`);

  const creditors: Entry[] = [];
  const debtors: Entry[] = [];
  for (const [id, v] of balances) {
    if (v > 0) creditors.push({ id, amount: v });
    else if (v < 0) debtors.push({ id, amount: -v });
  }

  const transfers: Transfer[] = [];
  while (creditors.length > 0 && debtors.length > 0) {
    creditors.sort(byAmountDescThenId);
    debtors.sort(byAmountDescThenId);
    const c = creditors[0]!;
    const d = debtors[0]!;
    const amount = Math.min(c.amount, d.amount);
    transfers.push({ from: d.id, to: c.id, amountMinor: amount });
    c.amount -= amount;
    d.amount -= amount;
    if (c.amount === 0) creditors.shift();
    if (d.amount === 0) debtors.shift();
  }
  return transfers;
}
