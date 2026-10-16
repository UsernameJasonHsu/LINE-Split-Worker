import {
  computeExpense,
  decimalsOf,
  formatMinor,
  formatMoney,
  parseRate,
  toMinor,
  type ComputedExpense,
  type Split,
} from '@line-split/core';
import type { Expense, ExpenseBody, Member, SplitType } from '../api';

export interface ExpenseForm {
  title: string;
  amount: string;
  currency: string;
  fxRate: string;
  /** True once the user typed a rate; only then is it sent (as MANUAL). */
  fxRateEdited: boolean;
  payerId: string;
  /** yyyy-mm-dd in local time. */
  date: string;
  splitType: SplitType;
  equalIds: string[];
  weights: Record<string, number>;
  exact: Record<string, string>;
}

const pad = (n: number) => String(n).padStart(2, '0');

export function toDateInput(ts: number): string {
  const d = new Date(ts);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

/** Local noon, so the date survives any timezone shift when displayed. */
export function fromDateInput(s: string): number {
  const [y = 1970, m = 1, d = 1] = s.split('-').map(Number);
  return new Date(y, m - 1, d, 12).getTime();
}

export const normalizeAmount = (s: string) => s.replace(/[,\s]/g, '');

export function emptyForm(members: Member[], meId: string, baseCurrency: string, now = Date.now()): ExpenseForm {
  return {
    title: '',
    amount: '',
    currency: baseCurrency,
    fxRate: '1',
    fxRateEdited: false,
    payerId: meId,
    date: toDateInput(now),
    splitType: 'equal',
    equalIds: members.map((m) => m.id),
    weights: Object.fromEntries(members.map((m) => [m.id, 1])),
    exact: {},
  };
}

export function formFromExpense(e: Expense, members: Member[]): ExpenseForm {
  const shareOf = new Map(e.shares.map((s) => [s.memberId, s]));
  return {
    ...emptyForm(members, e.payers[0]?.memberId ?? '', e.currency, e.spentAt),
    title: e.title,
    amount: formatMinor(e.amountMinor, e.currency),
    fxRate: e.fxRate,
    splitType: e.splitType,
    equalIds: e.splitType === 'equal' ? members.filter((m) => shareOf.has(m.id)).map((m) => m.id) : members.map((m) => m.id),
    weights: Object.fromEntries(
      members.map((m) => [m.id, e.splitType === 'weights' ? (shareOf.get(m.id)?.splitValue ?? 0) : 1]),
    ),
    exact:
      e.splitType === 'exact'
        ? Object.fromEntries(e.shares.map((s) => [s.memberId, formatMinor(s.shareMinor, e.currency)]))
        : {},
  };
}

function splitBody(f: ExpenseForm, members: Member[]): ExpenseBody['split'] {
  switch (f.splitType) {
    case 'equal':
      return { type: 'equal', memberIds: members.filter((m) => f.equalIds.includes(m.id)).map((m) => m.id) };
    case 'weights':
      return {
        type: 'weights',
        items: members
          .map((m) => ({ memberId: m.id, weight: f.weights[m.id] ?? 0 }))
          .filter((i) => i.weight > 0),
      };
    case 'exact':
      return {
        type: 'exact',
        items: members
          .map((m) => ({ memberId: m.id, amount: normalizeAmount(f.exact[m.id] ?? '') }))
          .filter((i) => i.amount !== '' && Number(i.amount) !== 0),
      };
  }
}

/** Request body for create/update. The rate is sent only when the user typed it. */
export function toPayload(f: ExpenseForm, baseCurrency: string, members: Member[]): ExpenseBody {
  const amount = normalizeAmount(f.amount);
  return {
    title: f.title.trim(),
    currency: f.currency,
    amount,
    ...(f.currency !== baseCurrency && f.fxRateEdited ? { fxRate: f.fxRate.trim() } : {}),
    spentAt: fromDateInput(f.date),
    payers: [{ memberId: f.payerId, amount }],
    split: splitBody(f, members),
  };
}

const DECIMAL = /^\d+(\.\d+)?$/;

function parseAmount(s: string, currency: string): number | string {
  if (!DECIMAL.test(s)) return '請輸入有效金額';
  try {
    return toMinor(s, currency);
  } catch {
    const d = decimalsOf(currency);
    return d === 0 ? `${currency} 不能有小數` : `${currency} 最多 ${d} 位小數`;
  }
}

export type Validation = { ok: true; computed: ComputedExpense } | { ok: false; error: string };

/** Live validation and preview of how the expense will be split. */
export function validate(f: ExpenseForm, baseCurrency: string, members: Member[]): Validation {
  const fail = (error: string): Validation => ({ ok: false, error });
  const body = toPayload(f, baseCurrency, members);

  const amountMinor = parseAmount(body.amount, f.currency);
  if (typeof amountMinor === 'string') return fail(body.amount ? amountMinor : '請輸入金額');
  if (amountMinor <= 0) return fail('金額必須大於 0');

  let fxRate = '1';
  if (f.currency !== baseCurrency) {
    fxRate = f.fxRate.trim();
    try {
      parseRate(fxRate);
    } catch {
      return fail('請輸入有效匯率');
    }
  }

  let split: Split;
  if (body.split.type === 'exact') {
    const items: { memberId: string; amountMinor: number }[] = [];
    for (const i of body.split.items) {
      const minor = parseAmount(i.amount, f.currency);
      if (typeof minor === 'string') return fail(minor);
      items.push({ memberId: i.memberId, amountMinor: minor });
    }
    const sum = items.reduce((s, i) => s + i.amountMinor, 0);
    if (sum !== amountMinor) {
      const diff = amountMinor - sum;
      return fail(
        diff > 0
          ? `還有 ${formatMoney(diff, f.currency)} 未分配`
          : `超出總額 ${formatMoney(-diff, f.currency)}`,
      );
    }
    split = { type: 'exact', items };
  } else {
    split = body.split;
  }
  const empty = split.type === 'equal' ? split.memberIds.length === 0 : split.items.length === 0;
  if (empty) return fail('請至少選擇一位分攤成員');

  try {
    return {
      ok: true,
      computed: computeExpense({
        currency: f.currency,
        amountMinor,
        fxRate,
        baseCurrency,
        payers: [{ memberId: f.payerId, amountMinor }],
        split,
      }),
    };
  } catch (err) {
    return fail((err as Error).message);
  }
}
