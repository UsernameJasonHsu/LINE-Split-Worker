import { computeExpense, toMinor, type ComputedExpense, type Split } from '@line-split/core';
import { HttpError } from '../errors';
import { getFxRate } from '../fx';
import type { ExpenseBody } from '../schemas';
import { auditStatement } from './audit';
import type { LedgerRow, MemberRow } from './ledgers';

export interface ExpenseDto {
  id: string;
  title: string;
  currency: string;
  amountMinor: number;
  fxRate: string;
  fxSource: 'NONE' | 'AUTO' | 'MANUAL';
  baseAmountMinor: number;
  splitType: Split['type'];
  category: string | null;
  spentAt: number;
  createdBy: string;
  createdAt: number;
  updatedAt: number;
  revision: string;
  payers: { memberId: string; amountMinor: number; baseAmountMinor: number }[];
  shares: { memberId: string; splitValue: number | null; shareMinor: number; baseShareMinor: number }[];
}

interface ExpenseRow {
  id: string;
  title: string;
  currency: string;
  amount_minor: number;
  fx_rate: string;
  fx_source: ExpenseDto['fxSource'];
  base_amount_minor: number;
  split_type: Split['type'];
  category: string | null;
  spent_at: number;
  created_by: string;
  created_at: number;
  updated_at: number;
  revision: string;
}

interface PayerRow {
  expense_id: string;
  member_id: string;
  amount_minor: number;
  base_amount_minor: number;
}

interface ShareRow {
  expense_id: string;
  member_id: string;
  split_value: number | null;
  share_minor: number;
  base_share_minor: number;
}

function toDto(row: ExpenseRow, payers: PayerRow[], shares: ShareRow[]): ExpenseDto {
  return {
    id: row.id,
    title: row.title,
    currency: row.currency,
    amountMinor: row.amount_minor,
    fxRate: row.fx_rate,
    fxSource: row.fx_source,
    baseAmountMinor: row.base_amount_minor,
    splitType: row.split_type,
    category: row.category,
    spentAt: row.spent_at,
    createdBy: row.created_by,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    revision: row.revision,
    payers: payers.map((p) => ({
      memberId: p.member_id,
      amountMinor: p.amount_minor,
      baseAmountMinor: p.base_amount_minor,
    })),
    shares: shares.map((s) => ({
      memberId: s.member_id,
      splitValue: s.split_value,
      shareMinor: s.share_minor,
      baseShareMinor: s.base_share_minor,
    })),
  };
}

function groupBy<T extends { expense_id: string }>(rows: T[]): Map<string, T[]> {
  const map = new Map<string, T[]>();
  for (const r of rows) {
    const list = map.get(r.expense_id);
    if (list) list.push(r);
    else map.set(r.expense_id, [r]);
  }
  return map;
}

export async function listExpenses(db: D1Database, ledgerId: string): Promise<ExpenseDto[]> {
  const live = 'JOIN expenses e ON e.id = x.expense_id WHERE e.ledger_id = ? AND e.deleted_at IS NULL ORDER BY x.rowid';
  const [expenses, payers, shares] = await db.batch([
    db
      .prepare('SELECT * FROM expenses WHERE ledger_id = ? AND deleted_at IS NULL ORDER BY spent_at DESC, created_at DESC')
      .bind(ledgerId),
    db.prepare(`SELECT x.* FROM expense_payers x ${live}`).bind(ledgerId),
    db.prepare(`SELECT x.* FROM expense_shares x ${live}`).bind(ledgerId),
  ]);
  const payersBy = groupBy(payers!.results as PayerRow[]);
  const sharesBy = groupBy(shares!.results as ShareRow[]);
  return (expenses!.results as ExpenseRow[]).map((e) =>
    toDto(e, payersBy.get(e.id) ?? [], sharesBy.get(e.id) ?? []),
  );
}

export async function getExpense(db: D1Database, ledgerId: string, id: string): Promise<ExpenseDto | null> {
  const [expense, payers, shares] = await db.batch([
    db.prepare('SELECT * FROM expenses WHERE id = ? AND ledger_id = ? AND deleted_at IS NULL').bind(id, ledgerId),
    db.prepare('SELECT * FROM expense_payers WHERE expense_id = ? ORDER BY rowid').bind(id),
    db.prepare('SELECT * FROM expense_shares WHERE expense_id = ? ORDER BY rowid').bind(id),
  ]);
  const row = expense!.results[0] as ExpenseRow | undefined;
  return row ? toDto(row, payers!.results as PayerRow[], shares!.results as ShareRow[]) : null;
}

interface PreparedExpense {
  computed: ComputedExpense;
  fxSource: ExpenseDto['fxSource'];
  splitValues: (number | null)[];
}

/**
 * Resolves the FX rate, converts amounts to minor units and runs the split.
 * `previous` is the expense being edited: when the edit keeps its currency and
 * gives no rate, the original rate is kept rather than re-pricing at today's.
 */
async function prepareExpense(
  db: D1Database,
  ledger: LedgerRow,
  members: MemberRow[],
  body: ExpenseBody,
  previous?: ExpenseDto,
): Promise<PreparedExpense> {
  const known = new Set(members.map((m) => m.id));
  const referenced = [
    ...body.payers.map((p) => p.memberId),
    ...(body.split.type === 'equal' ? body.split.memberIds : body.split.items.map((i) => i.memberId)),
  ];
  const unknown = referenced.find((id) => !known.has(id));
  if (unknown) throw new HttpError(400, `Unknown member: ${unknown}`);

  let fxRate: string;
  let fxSource: ExpenseDto['fxSource'];
  if (body.currency === ledger.base_currency) {
    fxRate = '1';
    fxSource = 'NONE';
  } else if (body.fxRate) {
    fxRate = body.fxRate;
    fxSource = 'MANUAL';
  } else if (previous && previous.currency === body.currency) {
    fxRate = previous.fxRate;
    fxSource = previous.fxSource;
  } else {
    fxRate = (await getFxRate(db, body.currency, ledger.base_currency)).rate;
    fxSource = 'AUTO';
  }

  try {
    const { currency, split } = body;
    let coreSplit: Split;
    let splitValues: (number | null)[];
    switch (split.type) {
      case 'equal':
        coreSplit = split;
        splitValues = split.memberIds.map(() => null);
        break;
      case 'weights':
        coreSplit = split;
        splitValues = split.items.map((i) => i.weight);
        break;
      case 'exact': {
        const items = split.items.map((i) => ({ memberId: i.memberId, amountMinor: toMinor(i.amount, currency) }));
        coreSplit = { type: 'exact', items };
        splitValues = items.map((i) => i.amountMinor);
        break;
      }
    }
    const computed = computeExpense({
      currency,
      amountMinor: toMinor(body.amount, currency),
      fxRate,
      baseCurrency: ledger.base_currency,
      payers: body.payers.map((p) => ({ memberId: p.memberId, amountMinor: toMinor(p.amount, currency) })),
      split: coreSplit,
    });
    return { computed, fxSource, splitValues };
  } catch (err) {
    throw new HttpError(400, (err as Error).message);
  }
}

const PAYER_COLUMNS = 'expense_id, member_id, amount_minor, base_amount_minor';
const SHARE_COLUMNS = 'expense_id, member_id, split_value, share_minor, base_share_minor';

export async function createExpense(
  db: D1Database,
  ledger: LedgerRow,
  members: MemberRow[],
  actor: MemberRow,
  body: ExpenseBody,
): Promise<ExpenseDto> {
  const { computed, fxSource, splitValues } = await prepareExpense(db, ledger, members, body);
  const id = crypto.randomUUID();
  const now = Date.now();

  await db.batch([
    db
      .prepare(
        `INSERT INTO expenses (id, ledger_id, title, currency, amount_minor, fx_rate, fx_source, base_amount_minor,
           split_type, category, spent_at, created_by, created_at, updated_at, revision)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .bind(
        id,
        ledger.id,
        body.title,
        computed.currency,
        computed.amountMinor,
        computed.fxRate,
        fxSource,
        computed.baseAmountMinor,
        body.split.type,
        body.category ?? null,
        body.spentAt ?? now,
        actor.id,
        now,
        now,
        crypto.randomUUID(),
      ),
    ...computed.payers.map((p) =>
      db
        .prepare(`INSERT INTO expense_payers (${PAYER_COLUMNS}) VALUES (?, ?, ?, ?)`)
        .bind(id, p.memberId, p.amountMinor, p.baseAmountMinor),
    ),
    ...computed.shares.map((s, i) =>
      db
        .prepare(`INSERT INTO expense_shares (${SHARE_COLUMNS}) VALUES (?, ?, ?, ?, ?)`)
        .bind(id, s.memberId, splitValues[i] ?? null, s.shareMinor, s.baseShareMinor),
    ),
    auditStatement(db, {
      ledgerId: ledger.id,
      actorMemberId: actor.id,
      action: 'create',
      entity: 'expense',
      entityId: id,
      after: body,
    }),
  ]);
  return (await getExpense(db, ledger.id, id))!;
}

/**
 * Replaces an expense if `revision` still matches. Every statement after the
 * header update is guarded on the freshly generated revision, so the whole
 * batch is a no-op when another edit got there first.
 */
export async function updateExpense(
  db: D1Database,
  ledger: LedgerRow,
  members: MemberRow[],
  actor: MemberRow,
  id: string,
  revision: string,
  body: ExpenseBody,
): Promise<ExpenseDto> {
  const before = await getExpense(db, ledger.id, id);
  if (!before) throw new HttpError(404, 'Expense not found');
  const { computed, fxSource, splitValues } = await prepareExpense(db, ledger, members, body, before);
  const newRevision = crypto.randomUUID();
  const guard = { sql: 'EXISTS (SELECT 1 FROM expenses WHERE id = ? AND revision = ?)', params: [id, newRevision] };

  const results = await db.batch([
    db
      .prepare(
        `UPDATE expenses SET title = ?, currency = ?, amount_minor = ?, fx_rate = ?, fx_source = ?,
           base_amount_minor = ?, split_type = ?, category = ?, spent_at = ?, updated_at = ?, revision = ?
         WHERE id = ? AND ledger_id = ? AND revision = ? AND deleted_at IS NULL`,
      )
      .bind(
        body.title,
        computed.currency,
        computed.amountMinor,
        computed.fxRate,
        fxSource,
        computed.baseAmountMinor,
        body.split.type,
        body.category ?? null,
        body.spentAt ?? before.spentAt,
        Date.now(),
        newRevision,
        id,
        ledger.id,
        revision,
      ),
    db.prepare(`DELETE FROM expense_payers WHERE expense_id = ? AND ${guard.sql}`).bind(id, ...guard.params),
    db.prepare(`DELETE FROM expense_shares WHERE expense_id = ? AND ${guard.sql}`).bind(id, ...guard.params),
    ...computed.payers.map((p) =>
      db
        .prepare(`INSERT INTO expense_payers (${PAYER_COLUMNS}) SELECT ?, ?, ?, ? WHERE ${guard.sql}`)
        .bind(id, p.memberId, p.amountMinor, p.baseAmountMinor, ...guard.params),
    ),
    ...computed.shares.map((s, i) =>
      db
        .prepare(`INSERT INTO expense_shares (${SHARE_COLUMNS}) SELECT ?, ?, ?, ?, ? WHERE ${guard.sql}`)
        .bind(id, s.memberId, splitValues[i] ?? null, s.shareMinor, s.baseShareMinor, ...guard.params),
    ),
    auditStatement(
      db,
      { ledgerId: ledger.id, actorMemberId: actor.id, action: 'update', entity: 'expense', entityId: id, before, after: body },
      guard,
    ),
  ]);

  if (results[0]!.meta.changes === 0) {
    throw new HttpError(409, 'Expense was changed by someone else; reload and try again');
  }
  return (await getExpense(db, ledger.id, id))!;
}

export async function deleteExpense(db: D1Database, ledger: LedgerRow, actor: MemberRow, id: string): Promise<void> {
  const before = await getExpense(db, ledger.id, id);
  if (!before) throw new HttpError(404, 'Expense not found');
  const [result] = await db.batch([
    db
      .prepare('UPDATE expenses SET deleted_at = ? WHERE id = ? AND ledger_id = ? AND deleted_at IS NULL')
      .bind(Date.now(), id, ledger.id),
    auditStatement(
      db,
      { ledgerId: ledger.id, actorMemberId: actor.id, action: 'delete', entity: 'expense', entityId: id, before },
      { sql: 'changes() > 0', params: [] },
    ),
  ]);
  if (result!.meta.changes === 0) throw new HttpError(404, 'Expense not found');
}
