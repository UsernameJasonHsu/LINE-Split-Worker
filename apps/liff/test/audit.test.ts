import { describe, expect, it } from 'vitest';
import type { AuditEntry, ExpenseSnapshot } from '../src/api';
import { describeAudit } from '../src/lib/audit';
import { fromDateInput } from '../src/lib/form';

const names: Record<string, string> = { a: 'Alice', b: 'Bob', c: 'Cara' };
const nameOf = (id: string) => names[id] ?? '（已離開）';

const snap = (patch: Partial<ExpenseSnapshot> = {}): ExpenseSnapshot => ({
  title: '拉麵',
  currency: 'TWD',
  amountMinor: 600,
  baseAmountMinor: 600,
  fxRate: '1',
  category: 'food',
  note: null,
  splitType: 'equal',
  spentAt: fromDateInput('2026-10-16'),
  payers: [{ memberId: 'a', amountMinor: 600 }],
  shares: [
    { memberId: 'a', shareMinor: 300 },
    { memberId: 'b', shareMinor: 300 },
  ],
  ...patch,
});

const entry = (patch: Partial<AuditEntry>): AuditEntry => ({
  id: 1,
  at: 0,
  actorMemberId: 'a',
  action: 'create',
  entity: 'expense',
  entityId: 'e1',
  before: null,
  after: null,
  ...patch,
});

describe('describeAudit', () => {
  it('describes a new expense with payers and shares', () => {
    expect(describeAudit(entry({ after: snap() }), nameOf, 'TWD')).toEqual({
      actor: 'Alice',
      kind: 'create',
      summary: '新增「拉麵」TWD 600',
      details: ['付款：Alice TWD 600', '分攤：Alice TWD 300、Bob TWD 300'],
    });
  });

  it('lists only what changed in an edit', () => {
    const before = snap();
    const after = snap({
      title: '拉麵＋煎餃',
      amountMinor: 900,
      category: null,
      note: '加點煎餃',
      spentAt: fromDateInput('2026-10-17'),
      splitType: 'weights',
      payers: [{ memberId: 'b', amountMinor: 900 }],
      shares: [
        { memberId: 'a', shareMinor: 600 },
        { memberId: 'c', shareMinor: 300 },
      ],
    });
    const d = describeAudit(entry({ action: 'update', actorMemberId: 'b', before, after }), nameOf, 'TWD');
    expect(d.summary).toBe('修改「拉麵＋煎餃」');
    expect(d.details).toEqual([
      '名稱：「拉麵」→「拉麵＋煎餃」',
      '金額：TWD 600 → TWD 900',
      '分類：餐飲 → 未分類',
      '備註：（無）→ 加點煎餃',
      '日期：10/16 → 10/17',
      '分攤方式：均分 → 份數',
      '付款：Alice TWD 600 → Bob TWD 900',
      'Alice 的份額：TWD 300 → TWD 600',
      'Bob 的份額：TWD 300 → （無）',
      'Cara 的份額：（無）→ TWD 300',
    ]);
  });

  it('says so when an edit changed nothing visible', () => {
    expect(describeAudit(entry({ action: 'update', before: snap(), after: snap() }), nameOf, 'TWD').details).toEqual([
      '（內容沒有變更）',
    ]);
  });

  it('describes deletions and repayments', () => {
    expect(describeAudit(entry({ action: 'delete', before: snap() }), nameOf, 'TWD').summary).toBe('刪除「拉麵」TWD 600');
    const s = { fromMemberId: 'b', toMemberId: 'a', amountMinor: 300 };
    expect(describeAudit(entry({ entity: 'settlement', after: s }), nameOf, 'TWD').summary).toBe(
      '記錄還款 Bob → Alice TWD 300',
    );
    expect(describeAudit(entry({ entity: 'settlement', action: 'delete', before: s }), nameOf, 'TWD').summary).toBe(
      '復原還款 Bob → Alice TWD 300',
    );
  });

  it('copes with legacy entries that lack shares or details', () => {
    const legacy = snap({ shares: null, spentAt: null, splitType: null });
    expect(describeAudit(entry({ after: legacy }), nameOf, 'TWD').details).toEqual(['付款：Alice TWD 600']);
    expect(describeAudit(entry({ entity: 'settlement', action: 'delete' }), nameOf, 'TWD').summary).toBe('復原一筆還款');
    expect(describeAudit(entry({ actorMemberId: null, after: snap() }), nameOf, 'TWD').actor).toBe('（已離開）');
  });
});
