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
