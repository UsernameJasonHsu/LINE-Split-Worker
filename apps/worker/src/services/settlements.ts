import { computeBalances, suggestTransfers, toMinor, type Transfer } from '@line-split/core';
import { HttpError } from '../errors';
import type { SettlementBody } from '../schemas';
import { auditStatement } from './audit';
import { listExpenses } from './expenses';
import type { LedgerRow, MemberRow } from './ledgers';

export interface SettlementDto {
  id: string;
  fromMemberId: string;
  toMemberId: string;
  amountMinor: number;
  settledAt: number;
  createdBy: string;
}

interface SettlementRow {
  id: string;
  from_member: string;
  to_member: string;
  amount_minor: number;
  settled_at: number;
  created_by: string;
}

const toDto = (r: SettlementRow): SettlementDto => ({
  id: r.id,
  fromMemberId: r.from_member,
  toMemberId: r.to_member,
  amountMinor: r.amount_minor,
  settledAt: r.settled_at,
  createdBy: r.created_by,
});

export async function listSettlements(db: D1Database, ledgerId: string): Promise<SettlementDto[]> {
  const { results } = await db
    .prepare(
      'SELECT * FROM settlements WHERE ledger_id = ? AND deleted_at IS NULL ORDER BY settled_at DESC, created_at DESC',
    )
    .bind(ledgerId)
    .all<SettlementRow>();
  return results.map(toDto);
}

export async function createSettlement(
  db: D1Database,
  ledger: LedgerRow,
  members: MemberRow[],
  actor: MemberRow,
  body: SettlementBody,
): Promise<SettlementDto> {
  const known = new Set(members.map((m) => m.id));
  if (!known.has(body.fromMemberId) || !known.has(body.toMemberId)) throw new HttpError(400, 'Unknown member');
  if (body.fromMemberId === body.toMemberId) throw new HttpError(400, 'Cannot settle with yourself');

  let amountMinor: number;
  try {
    amountMinor = toMinor(body.amount, ledger.base_currency);
  } catch (err) {
    throw new HttpError(400, (err as Error).message);
  }
  if (amountMinor <= 0) throw new HttpError(400, 'Amount must be positive');

  const now = Date.now();
  const row: SettlementRow = {
    id: crypto.randomUUID(),
    from_member: body.fromMemberId,
    to_member: body.toMemberId,
    amount_minor: amountMinor,
    settled_at: body.settledAt ?? now,
    created_by: actor.id,
  };
  await db.batch([
    db
      .prepare(
        `INSERT INTO settlements (id, ledger_id, from_member, to_member, amount_minor, settled_at, created_by, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .bind(row.id, ledger.id, row.from_member, row.to_member, row.amount_minor, row.settled_at, row.created_by, now),
    auditStatement(db, {
      ledgerId: ledger.id,
      actorMemberId: actor.id,
      action: 'create',
      entity: 'settlement',
      entityId: row.id,
      after: toDto(row),
    }),
  ]);
  return toDto(row);
}

export async function deleteSettlement(db: D1Database, ledger: LedgerRow, actor: MemberRow, id: string): Promise<void> {
  const before = await db
    .prepare('SELECT * FROM settlements WHERE id = ? AND ledger_id = ? AND deleted_at IS NULL')
    .bind(id, ledger.id)
    .first<SettlementRow>();
  if (!before) throw new HttpError(404, 'Settlement not found');
  const [result] = await db.batch([
    db
      .prepare('UPDATE settlements SET deleted_at = ? WHERE id = ? AND ledger_id = ? AND deleted_at IS NULL')
      .bind(Date.now(), id, ledger.id),
    auditStatement(
      db,
      {
        ledgerId: ledger.id,
        actorMemberId: actor.id,
        action: 'delete',
        entity: 'settlement',
        entityId: id,
        before: toDto(before),
      },
      { sql: 'changes() > 0', params: [] },
    ),
  ]);
  if (result!.meta.changes === 0) throw new HttpError(404, 'Settlement not found');
}

export interface SummaryDto {
  baseCurrency: string;
  totalSpentMinor: number;
  balances: { memberId: string; balanceMinor: number }[];
  transfers: Transfer[];
}

export async function getSummary(db: D1Database, ledger: LedgerRow, members: MemberRow[]): Promise<SummaryDto> {
  const [expenses, settlements] = await Promise.all([listExpenses(db, ledger.id), listSettlements(db, ledger.id)]);
  const balances = computeBalances(
    expenses,
    settlements.map((s) => ({ from: s.fromMemberId, to: s.toMemberId, amountMinor: s.amountMinor })),
  );
  for (const m of members) if (!balances.has(m.id)) balances.set(m.id, 0);

  return {
    baseCurrency: ledger.base_currency,
    totalSpentMinor: expenses.reduce((sum, e) => sum + e.baseAmountMinor, 0),
    balances: [...balances].map(([memberId, balanceMinor]) => ({ memberId, balanceMinor })),
    transfers: suggestTransfers(balances),
  };
}
