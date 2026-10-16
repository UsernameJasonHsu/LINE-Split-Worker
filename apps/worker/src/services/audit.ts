import { toMinor } from '@line-split/core';
import type { ExpenseSnapshot } from './expenses';

export interface AuditEntry {
  ledgerId: string;
  actorMemberId: string;
  action: 'create' | 'update' | 'delete';
  entity: 'expense' | 'settlement';
  entityId: string;
  before?: unknown;
  after?: unknown;
}

/**
 * Builds the audit insert. With `guard`, the row is only written when the
 * guard SQL (an EXISTS clause) holds, so it can join a conditional batch.
 */
export function auditStatement(
  db: D1Database,
  e: AuditEntry,
  guard?: { sql: string; params: unknown[] },
): D1PreparedStatement {
  const values = [
    e.ledgerId,
    e.actorMemberId,
    e.action,
    e.entity,
    e.entityId,
    e.before === undefined ? null : JSON.stringify(e.before),
    e.after === undefined ? null : JSON.stringify(e.after),
    Date.now(),
  ];
  const columns = 'ledger_id, actor_member_id, action, entity, entity_id, before_json, after_json, at';
  if (!guard) {
    return db.prepare(`INSERT INTO audit_logs (${columns}) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`).bind(...values);
  }
  return db
    .prepare(`INSERT INTO audit_logs (${columns}) SELECT ?, ?, ?, ?, ?, ?, ?, ? WHERE ${guard.sql}`)
    .bind(...values, ...guard.params);
}

export interface SettlementSnapshot {
  fromMemberId: string;
  toMemberId: string;
  amountMinor: number;
}

export interface AuditEntryDto {
  id: number;
  at: number;
  actorMemberId: string | null;
  action: AuditEntry['action'];
  entity: AuditEntry['entity'];
  entityId: string;
  before: ExpenseSnapshot | SettlementSnapshot | null;
  after: ExpenseSnapshot | SettlementSnapshot | null;
}

type Json = Record<string, any>;

function minorOr(amount: unknown, currency: string): number {
  try {
    return toMinor(String(amount), currency);
  } catch {
    return 0;
  }
}

/**
 * Brings an expense entry to the snapshot shape. Entries written before
 * snapshots existed hold the raw request body (decimal strings, no computed
 * shares), so convert what can be recovered and leave shares null.
 */
function normalizeExpense(raw: Json | null): ExpenseSnapshot | null {
  if (!raw) return null;
  const currency = String(raw.currency ?? '');
  const computed = typeof raw.amountMinor === 'number';
  return {
    title: String(raw.title ?? ''),
    currency,
    amountMinor: computed ? raw.amountMinor : minorOr(raw.amount, currency),
    baseAmountMinor: typeof raw.baseAmountMinor === 'number' ? raw.baseAmountMinor : 0,
    fxRate: String(raw.fxRate ?? '1'),
    category: raw.category ?? null,
    note: raw.note ?? null,
    splitType: raw.splitType ?? raw.split?.type ?? null,
    spentAt: typeof raw.spentAt === 'number' ? raw.spentAt : null,
    payers: (raw.payers ?? []).map((p: Json) => ({
      memberId: p.memberId,
      amountMinor: typeof p.amountMinor === 'number' ? p.amountMinor : minorOr(p.amount, currency),
    })),
    shares: Array.isArray(raw.shares)
      ? raw.shares.map((s: Json) => ({ memberId: s.memberId, shareMinor: s.shareMinor }))
      : null,
  };
}

function normalizeSettlement(raw: Json | null): SettlementSnapshot | null {
  if (!raw) return null;
  return { fromMemberId: raw.fromMemberId, toMemberId: raw.toMemberId, amountMinor: raw.amountMinor };
}

export async function listAudit(db: D1Database, ledgerId: string, limit = 200): Promise<AuditEntryDto[]> {
  const { results } = await db
    .prepare('SELECT * FROM audit_logs WHERE ledger_id = ? ORDER BY at DESC, id DESC LIMIT ?')
    .bind(ledgerId, limit)
    .all<{
      id: number;
      actor_member_id: string | null;
      action: AuditEntry['action'];
      entity: AuditEntry['entity'];
      entity_id: string;
      before_json: string | null;
      after_json: string | null;
      at: number;
    }>();
  return results.map((r) => {
    const parse = (s: string | null) => (s ? (JSON.parse(s) as Json) : null);
    const normalize = r.entity === 'expense' ? normalizeExpense : normalizeSettlement;
    return {
      id: r.id,
      at: r.at,
      actorMemberId: r.actor_member_id,
      action: r.action,
      entity: r.entity,
      entityId: r.entity_id,
      before: normalize(parse(r.before_json)),
      after: normalize(parse(r.after_json)),
    };
  });
}
