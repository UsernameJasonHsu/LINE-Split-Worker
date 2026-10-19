import type { ComputedExpense } from '@line-split/core';
import { formatMoney, guessCategory } from '@line-split/core';

export { guessCategory };

/**
 * Typing shortcuts for the expense form: past titles to pick from, and the
 * message posted to the chat after saving. (Category guessing lives in core,
 * shared with the bot.)
 */

interface PastExpense {
  title: string;
  category: string | null;
  createdAt: number;
}

const normalize = (title: string) => title.trim().toLowerCase();

/** Distinct past titles, most recently used first. */
export function pastTitles(expenses: PastExpense[], limit = 30): string[] {
  const seen = new Set<string>();
  const titles: string[] = [];
  for (const e of [...expenses].sort((a, b) => b.createdAt - a.createdAt)) {
    const key = normalize(e.title);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    titles.push(e.title.trim());
    if (titles.length === limit) break;
  }
  return titles;
}

/** Chat message announcing a new expense, e.g. "🧾 Alice 記了「晚餐」TWD 1,200". */
export function expenseNotice(
  title: string,
  computed: ComputedExpense,
  nameOf: (memberId: string) => string,
  link: string,
): string {
  const shares = computed.shares.filter((s) => s.shareMinor > 0);
  const amounts = new Set(shares.map((s) => s.shareMinor));
  const payers = computed.payers.map((p) => nameOf(p.memberId)).join('、');
  const split =
    amounts.size === 1
      ? `${shares.length} 人均分，每人 ${formatMoney(shares[0]!.shareMinor, computed.currency)}`
      : `${shares.length} 人分攤：${shares.map((s) => `${nameOf(s.memberId)} ${formatMoney(s.shareMinor, computed.currency)}`).join('、')}`;
  return [
    `🧾 「${title.trim()}」${formatMoney(computed.amountMinor, computed.currency)}`,
    `${payers} 付款，${split}`,
    `查看帳本：${link}`,
  ].join('\n');
}

/** The ledger's most used titles (ties: most recent first), for one-tap chips. */
export function frequentTitles(expenses: PastExpense[], limit = 6): string[] {
  const stats = new Map<string, { title: string; count: number; last: number }>();
  for (const e of expenses) {
    const key = normalize(e.title);
    if (!key) continue;
    const s = stats.get(key);
    if (s) {
      s.count++;
      if (e.createdAt > s.last) Object.assign(s, { last: e.createdAt, title: e.title.trim() });
    } else stats.set(key, { title: e.title.trim(), count: 1, last: e.createdAt });
  }
  return [...stats.values()]
    .sort((a, b) => b.count - a.count || b.last - a.last)
    .slice(0, limit)
    .map((s) => s.title);
}

/**
 * Groups of people who often split together (besides everyone), most used
 * first, so a recurring "the three of us" is one tap.
 */
export function splitPresets(
  expenses: { createdAt: number; shares: { memberId: string; shareMinor: number }[] }[],
  memberIds: string[],
  limit = 3,
): string[][] {
  const current = new Set(memberIds);
  const stats = new Map<string, { ids: string[]; count: number; last: number }>();
  for (const e of expenses) {
    const ids = e.shares.filter((s) => s.shareMinor > 0 && current.has(s.memberId)).map((s) => s.memberId).sort();
    if (ids.length === 0 || ids.length === current.size) continue;
    const key = ids.join(',');
    const s = stats.get(key);
    if (s) {
      s.count++;
      s.last = Math.max(s.last, e.createdAt);
    } else stats.set(key, { ids, count: 1, last: e.createdAt });
  }
  return [...stats.values()]
    .sort((a, b) => b.count - a.count || b.last - a.last)
    .slice(0, limit)
    .map((s) => s.ids);
}
