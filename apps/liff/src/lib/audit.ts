import { formatMoney } from '@line-split/core';
import type { AuditEntry, ExpenseSnapshot, SettlementSnapshot, SplitType } from '../api';
import { categoryMeta } from './categories';
import { toDateInput } from './form';

const SPLIT_LABELS: Record<SplitType, string> = {
  equal: '均分',
  weights: '份數',
  exact: '指定金額',
  fixed_rest: '部分指定',
};

const NONE = '（無）';

export interface AuditDescription {
  actor: string;
  kind: AuditEntry['action'];
  summary: string;
  details: string[];
}

/** "A → B", without the space next to full-width brackets (「」、（）). */
const arrow = (from: string, to: string) =>
  `${from}${/[」）]$/.test(from) ? '' : ' '}→${/^[「（]/.test(to) && !/^（無）$/.test(to) ? '' : ' '}${to}`;

const shortDate = (ts: number) => {
  const [, m, d] = toDateInput(ts).split('-');
  return `${Number(m)}/${Number(d)}`;
};

/** Human-readable description of one audit entry; `baseCurrency` prices repayments. */
export function describeAudit(
  entry: AuditEntry,
  nameOf: (memberId: string) => string,
  baseCurrency: string,
): AuditDescription {
  const actor = entry.actorMemberId ? nameOf(entry.actorMemberId) : '（已離開）';
  const base = { actor, kind: entry.action };

  if (entry.entity === 'settlement') {
    const s = (entry.after ?? entry.before) as SettlementSnapshot | null;
    const verb = entry.action === 'delete' ? '復原' : '記錄';
    if (!s) return { ...base, summary: `${verb}一筆還款`, details: [] };
    return {
      ...base,
      summary: `${verb}還款 ${nameOf(s.fromMemberId)} → ${nameOf(s.toMemberId)} ${formatMoney(s.amountMinor, baseCurrency)}`,
      details: [],
    };
  }

  const before = entry.before as ExpenseSnapshot | null;
  const after = entry.after as ExpenseSnapshot | null;
  const money = (e: ExpenseSnapshot, minor: number) => formatMoney(minor, e.currency);
  const payersText = (e: ExpenseSnapshot) =>
    e.payers.map((p) => `${nameOf(p.memberId)} ${money(e, p.amountMinor)}`).join('、') || NONE;
  const sharesText = (e: ExpenseSnapshot) =>
    e.shares?.map((s) => `${nameOf(s.memberId)} ${money(e, s.shareMinor)}`).join('、');

  if (entry.action === 'update' && before && after) {
    const details: string[] = [];
    const change = (label: string, from: string, to: string) => {
      if (from !== to) details.push(`${label}：${arrow(from, to)}`);
    };
    change('名稱', `「${before.title}」`, `「${after.title}」`);
    change('金額', money(before, before.amountMinor), money(after, after.amountMinor));
    change('分類', categoryMeta(before.category).label, categoryMeta(after.category).label);
    change('備註', before.note ?? NONE, after.note ?? NONE);
    if (before.spentAt !== null && after.spentAt !== null) {
      change('日期', shortDate(before.spentAt), shortDate(after.spentAt));
    }
    if (before.splitType && after.splitType) {
      change('分攤方式', SPLIT_LABELS[before.splitType], SPLIT_LABELS[after.splitType]);
    }
    change('付款', payersText(before), payersText(after));
    if (before.shares && after.shares) {
      const ids = [...new Set([...before.shares, ...after.shares].map((s) => s.memberId))];
      for (const id of ids) {
        const from = before.shares.find((s) => s.memberId === id);
        const to = after.shares.find((s) => s.memberId === id);
        change(
          `${nameOf(id)} 的份額`,
          from ? money(before, from.shareMinor) : NONE,
          to ? money(after, to.shareMinor) : NONE,
        );
      }
    }
    return { ...base, summary: `修改「${after.title}」`, details: details.length ? details : ['（內容沒有變更）'] };
  }

  const e = after ?? before;
  if (!e) return { ...base, summary: entry.action === 'delete' ? '刪除一筆支出' : '新增一筆支出', details: [] };
  const verb = entry.action === 'delete' ? '刪除' : '新增';
  const shares = sharesText(e);
  return {
    ...base,
    summary: `${verb}「${e.title}」${money(e, e.amountMinor)}`,
    details: entry.action === 'delete' ? [] : [`付款：${payersText(e)}`, ...(shares ? [`分攤：${shares}`] : [])],
  };
}
