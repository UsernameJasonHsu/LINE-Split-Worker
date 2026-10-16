import {
  computeExpense,
  decimalsOf,
  formatMinor,
  formatMoney,
  parseRate,
  toMinor,
  type ComputedExpense,
  type ExpenseCategory,
  type Split,
} from '@line-split/core';
import { resolveAmount } from './calc';
import type { Expense, ExpenseBody, Member, SplitType } from '../api';

export interface ExpenseForm {
  title: string;
  amount: string;
  currency: string;
  fxRate: string;
  /** True once the user typed a rate; only then is it sent (as MANUAL). */
  fxRateEdited: boolean;
  /** Single payer (when `multiPayer` is false). */
  payerId: string;
  multiPayer: boolean;
  /** Amount paid per member when `multiPayer` is true. */
  payerAmounts: Record<string, string>;
  /** yyyy-mm-dd in local time. */
  date: string;
  splitType: SplitType;
  category: ExpenseCategory | null;
  equalIds: string[];
  weights: Record<string, number>;
  exact: Record<string, string>;
  /** fixed_rest: fixed amount per member (blank = none). */
  fixed: Record<string, string>;
  /** fixed_rest: members who split the remainder equally. */
  restIds: string[];
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

export function emptyForm(members: Member[], meId: string, baseCurrency: string, now = Date.now()): ExpenseForm {
  return {
    title: '',
    amount: '',
    currency: baseCurrency,
    fxRate: '1',
    fxRateEdited: false,
    payerId: meId,
    multiPayer: false,
    payerAmounts: {},
    date: toDateInput(now),
    splitType: 'equal',
    equalIds: members.map((m) => m.id),
    weights: Object.fromEntries(members.map((m) => [m.id, 1])),
    exact: {},
    fixed: {},
    restIds: members.map((m) => m.id),
    category: null,
  };
}

export function formFromExpense(e: Expense, members: Member[]): ExpenseForm {
  const shareOf = new Map(e.shares.map((s) => [s.memberId, s]));
  return {
    ...emptyForm(members, e.payers[0]?.memberId ?? '', e.currency, e.spentAt),
    title: e.title,
    amount: formatMinor(e.amountMinor, e.currency),
    fxRate: e.fxRate,
    multiPayer: e.payers.length > 1,
    payerAmounts:
      e.payers.length > 1
        ? Object.fromEntries(e.payers.map((p) => [p.memberId, formatMinor(p.amountMinor, e.currency)]))
        : {},
    splitType: e.splitType,
    category: (e.category as ExpenseCategory | null) ?? null,
    equalIds:
      e.splitType === 'equal' ? members.filter((m) => shareOf.has(m.id)).map((m) => m.id) : members.map((m) => m.id),
    weights: Object.fromEntries(
      members.map((m) => [m.id, e.splitType === 'weights' ? (shareOf.get(m.id)?.splitValue ?? 0) : 1]),
    ),
    exact:
      e.splitType === 'exact'
        ? Object.fromEntries(e.shares.map((s) => [s.memberId, formatMinor(s.shareMinor, e.currency)]))
        : {},
    ...(e.splitType === 'fixed_rest' && {
      fixed: Object.fromEntries(
        e.shares.filter((s) => s.splitValue !== null).map((s) => [s.memberId, formatMinor(s.splitValue!, e.currency)]),
      ),
      restIds: members.filter((m) => shareOf.get(m.id)?.inRest).map((m) => m.id),
    }),
  };
}

function splitBody(f: ExpenseForm, members: Member[]): ExpenseBody['split'] {
  switch (f.splitType) {
    case 'equal':
      return { type: 'equal', memberIds: members.filter((m) => f.equalIds.includes(m.id)).map((m) => m.id) };
    case 'weights':
      return {
        type: 'weights',
        items: members.map((m) => ({ memberId: m.id, weight: f.weights[m.id] ?? 0 })).filter((i) => i.weight > 0),
      };
    case 'exact':
      return {
        type: 'exact',
        items: members
          .map((m) => ({ memberId: m.id, amount: resolveAmount(f.exact[m.id] ?? '', f.currency) }))
          .filter((i) => i.amount !== '' && Number(i.amount) !== 0),
      };
    case 'fixed_rest':
      return {
        type: 'fixed_rest',
        fixed: members
          .map((m) => ({ memberId: m.id, amount: resolveAmount(f.fixed[m.id] ?? '', f.currency) }))
          .filter((i) => i.amount !== '' && Number(i.amount) !== 0),
        restMemberIds: members.filter((m) => f.restIds.includes(m.id)).map((m) => m.id),
      };
  }
}

/** fixed_rest: amount left after fixed amounts (minor units), or null while input is incomplete. */
export function fixedRestRemainder(f: ExpenseForm, members: Member[]): number | null {
  try {
    const total = toMinor(resolveAmount(f.amount, f.currency), f.currency);
    let fixed = 0;
    for (const m of members) {
      const v = resolveAmount(f.fixed[m.id] ?? '', f.currency);
      if (v !== '' && Number(v) !== 0) fixed += toMinor(v, f.currency);
    }
    return total - fixed;
  } catch {
    return null;
  }
}

/** Request body for create/update. The rate is sent only when the user typed it. */
export function toPayload(f: ExpenseForm, baseCurrency: string, members: Member[]): ExpenseBody {
  const amount = resolveAmount(f.amount, f.currency);
  return {
    title: f.title.trim(),
    currency: f.currency,
    amount,
    ...(f.currency !== baseCurrency && f.fxRateEdited ? { fxRate: f.fxRate.trim() } : {}),
    spentAt: fromDateInput(f.date),
    category: f.category,
    payers: f.multiPayer
      ? members
          .map((m) => ({ memberId: m.id, amount: resolveAmount(f.payerAmounts[m.id] ?? '', f.currency) }))
          .filter((p) => p.amount !== '' && Number(p.amount) !== 0)
      : [{ memberId: f.payerId, amount }],
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

/**
 * Parses per-member amounts that must add up to `total`. Returns the parsed
 * parts or an error explaining what is missing / over.
 */
function parseParts(
  parts: { memberId: string; amount: string }[],
  total: number,
  currency: string,
  messages: { short: (money: string) => string; over: (money: string) => string },
): { memberId: string; amountMinor: number }[] | string {
  const parsed: { memberId: string; amountMinor: number }[] = [];
  for (const p of parts) {
    const minor = parseAmount(p.amount, currency);
    if (typeof minor === 'string') return minor;
    parsed.push({ memberId: p.memberId, amountMinor: minor });
  }
  const diff = total - parsed.reduce((s, p) => s + p.amountMinor, 0);
  if (diff > 0) return messages.short(formatMoney(diff, currency));
  if (diff < 0) return messages.over(formatMoney(-diff, currency));
  return parsed;
}

export type ValidationField = 'amount' | 'fx' | 'payers' | 'split';

export type Validation = { ok: true; computed: ComputedExpense } | { ok: false; error: string; field: ValidationField };

/** Live validation and preview of how the expense will be split. */
export function validate(f: ExpenseForm, baseCurrency: string, members: Member[]): Validation {
  const fail = (error: string, field: ValidationField): Validation => ({ ok: false, error, field });
  const body = toPayload(f, baseCurrency, members);

  const amountMinor = parseAmount(body.amount, f.currency);
  if (typeof amountMinor === 'string') return fail(body.amount ? amountMinor : '請輸入金額', 'amount');
  if (amountMinor <= 0) return fail('金額必須大於 0', 'amount');

  let fxRate = '1';
  if (f.currency !== baseCurrency) {
    fxRate = f.fxRate.trim();
    try {
      parseRate(fxRate);
    } catch {
      return fail('請輸入有效匯率', 'fx');
    }
  }

  let payers: { memberId: string; amountMinor: number }[] = [{ memberId: f.payerId, amountMinor }];
  if (f.multiPayer) {
    if (body.payers.length === 0) return fail('請輸入各付款人的金額', 'payers');
    const parsed = parseParts(body.payers, amountMinor, f.currency, {
      short: (m) => `付款還差 ${m}`,
      over: (m) => `付款超出總額 ${m}`,
    });
    if (typeof parsed === 'string') return fail(parsed, 'payers');
    payers = parsed;
  }

  let split: Split;
  if (body.split.type === 'exact') {
    const items = parseParts(body.split.items, amountMinor, f.currency, {
      short: (m) => `還有 ${m} 未分配`,
      over: (m) => `超出總額 ${m}`,
    });
    if (typeof items === 'string') return fail(items, 'split');
    split = { type: 'exact', items };
  } else if (body.split.type === 'fixed_rest') {
    const fixed: { memberId: string; amountMinor: number }[] = [];
    for (const i of body.split.fixed) {
      const minor = parseAmount(i.amount, f.currency);
      if (typeof minor === 'string') return fail(minor, 'split');
      fixed.push({ memberId: i.memberId, amountMinor: minor });
    }
    const rest = amountMinor - fixed.reduce((s, i) => s + i.amountMinor, 0);
    if (rest < 0) return fail(`指定金額超出總額 ${formatMoney(-rest, f.currency)}`, 'split');
    if (rest > 0 && body.split.restMemberIds.length === 0) {
      return fail(`剩餘 ${formatMoney(rest, f.currency)} 請至少勾選一人平分`, 'split');
    }
    split = { type: 'fixed_rest', fixed, restMemberIds: body.split.restMemberIds };
  } else {
    split = body.split;
  }
  const empty =
    split.type === 'equal'
      ? split.memberIds.length === 0
      : split.type === 'fixed_rest'
        ? split.fixed.length === 0 && split.restMemberIds.length === 0
        : split.items.length === 0;
  if (empty) return fail('請至少選擇一位分攤成員', 'split');

  try {
    return {
      ok: true,
      computed: computeExpense({
        currency: f.currency,
        amountMinor,
        fxRate,
        baseCurrency,
        payers,
        split,
      }),
    };
  } catch (err) {
    return fail((err as Error).message, 'split');
  }
}
