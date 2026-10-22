export interface LedgerRow {
  id: string;
  line_group_id: string | null;
  name: string;
  base_currency: string;
  created_at: number;
  /** Set while the bot is not in the group. */
  archived_at: number | null;
  /** Set once the ledger is finished; it is then read-only. */
  closed_at: number | null;
  /** The ledger started when this one was closed. */
  successor_id: string | null;
}

export interface MemberRow {
  id: string;
  ledger_id: string;
  line_user_id: string | null;
  display_name: string;
  avatar_url: string | null;
  is_virtual: number;
  joined_at: number;
  /** When they left the LINE group; such members can no longer open the ledger. */
  left_at: number | null;
  /** From payment_profiles; only present when loaded via listMembers. */
  payment_info?: string | null;
}

export function findLedger(db: D1Database, id: string): Promise<LedgerRow | null> {
  return db.prepare('SELECT * FROM ledgers WHERE id = ?').bind(id).first<LedgerRow>();
}

/** The group's open ledger (at most one, enforced by a partial unique index). */
export function findOpenLedgerByGroup(db: D1Database, groupId: string): Promise<LedgerRow | null> {
  return db
    .prepare('SELECT * FROM ledgers WHERE line_group_id = ? AND closed_at IS NULL')
    .bind(groupId)
    .first<LedgerRow>();
}

/** Returns the group's open ledger, creating (or un-archiving) it as needed. */
export async function ensureGroupLedger(
  db: D1Database,
  groupId: string,
  loadName: () => Promise<string>,
): Promise<LedgerRow> {
  const existing = await findOpenLedgerByGroup(db, groupId);
  if (existing) {
    if (existing.archived_at !== null) {
      await db.prepare('UPDATE ledgers SET archived_at = NULL WHERE id = ?').bind(existing.id).run();
      existing.archived_at = null;
    }
    return existing;
  }

  await db
    .prepare(
      `INSERT INTO ledgers (id, line_group_id, name, base_currency, created_at)
       VALUES (?, ?, ?, 'TWD', ?) ON CONFLICT DO NOTHING`,
    )
    .bind(crypto.randomUUID(), groupId, await loadName(), Date.now())
    .run();
  // Re-read so a concurrent insert for the same group resolves to one ledger.
  return (await findOpenLedgerByGroup(db, groupId))!;
}

export async function archiveGroupLedger(db: D1Database, groupId: string): Promise<void> {
  await db
    .prepare('UPDATE ledgers SET archived_at = ? WHERE line_group_id = ? AND closed_at IS NULL AND archived_at IS NULL')
    .bind(Date.now(), groupId)
    .run();
}

/** Most recently created ledger of the group, open or closed. */
export function findLatestLedgerByGroup(db: D1Database, groupId: string): Promise<LedgerRow | null> {
  return db
    .prepare('SELECT * FROM ledgers WHERE line_group_id = ? ORDER BY created_at DESC, rowid DESC LIMIT 1')
    .bind(groupId)
    .first<LedgerRow>();
}

/** Marks the ledger finished (read-only). Returns false if it was already closed. */
export async function closeLedger(db: D1Database, ledgerId: string): Promise<boolean> {
  const result = await db
    .prepare('UPDATE ledgers SET closed_at = ? WHERE id = ? AND closed_at IS NULL')
    .bind(Date.now(), ledgerId)
    .run();
  return result.meta.changes > 0;
}

/**
 * Opens a new ledger for `previous`'s group with its base currency, copying
 * the chosen members (all when `memberIds` is undefined) plus the starter.
 * The partial unique index allows one open ledger per group, so the insert is
 * a no-op when one already exists (including a concurrent start); the member
 * copy is guarded on the new ledger existing. Returns the new ledger id, or
 * null if the group already has an open ledger.
 */
export async function startNextLedger(
  db: D1Database,
  previous: LedgerRow,
  name: string,
  carry: { memberIds?: string[]; starterLineUserId: string },
): Promise<string | null> {
  const chosen = carry.memberIds ? JSON.stringify(carry.memberIds) : null;
  const nextId = crypto.randomUUID();
  const created = 'EXISTS (SELECT 1 FROM ledgers WHERE id = ?)';
  const [inserted] = await db.batch([
    db
      .prepare(
        `INSERT INTO ledgers (id, line_group_id, name, base_currency, created_at, archived_at)
         SELECT ?, line_group_id, ?, base_currency, ?, archived_at FROM ledgers
         WHERE id = ? AND line_group_id IS NOT NULL
         ON CONFLICT DO NOTHING`,
      )
      .bind(nextId, name, Date.now(), previous.id),
    db
      .prepare(
        `INSERT INTO members (id, ledger_id, line_user_id, display_name, avatar_url, is_virtual, joined_at)
         SELECT lower(hex(randomblob(16))), ?, line_user_id, display_name, avatar_url, is_virtual, joined_at
         FROM members
         WHERE ledger_id = ? AND left_at IS NULL
           AND (? IS NULL OR id IN (SELECT value FROM json_each(?)) OR line_user_id = ?)
           AND ${created}`,
      )
      .bind(nextId, previous.id, chosen, chosen, carry.starterLineUserId, nextId),
    db.prepare(`UPDATE ledgers SET successor_id = ? WHERE id = ? AND ${created}`).bind(nextId, previous.id, nextId),
  ]);
  return inserted!.meta.changes === 0 ? null : nextId;
}

export interface GroupLedgerSummary {
  id: string;
  name: string;
  baseCurrency: string;
  createdAt: number;
  closedAt: number | null;
  totalSpentMinor: number;
  isMember: boolean;
}

/** Every ledger the group has had, newest first. */
export async function listGroupLedgers(
  db: D1Database,
  groupId: string,
  lineUserId: string,
): Promise<GroupLedgerSummary[]> {
  const { results } = await db
    .prepare(
      `SELECT l.id, l.name, l.base_currency, l.created_at, l.closed_at,
         COALESCE((SELECT SUM(e.base_amount_minor) FROM expenses e
                   WHERE e.ledger_id = l.id AND e.deleted_at IS NULL), 0) AS total,
         EXISTS (SELECT 1 FROM members m
                 WHERE m.ledger_id = l.id AND m.line_user_id = ? AND m.left_at IS NULL) AS is_member
       FROM ledgers l WHERE l.line_group_id = ? ORDER BY l.created_at DESC`,
    )
    .bind(lineUserId, groupId)
    .all<{
      id: string;
      name: string;
      base_currency: string;
      created_at: number;
      closed_at: number | null;
      total: number;
      is_member: number;
    }>();
  return results.map((r) => ({
    id: r.id,
    name: r.name,
    baseCurrency: r.base_currency,
    createdAt: r.created_at,
    closedAt: r.closed_at,
    totalSpentMinor: r.total,
    isMember: r.is_member === 1,
  }));
}

export async function hasLedgerActivity(db: D1Database, ledgerId: string): Promise<boolean> {
  const row = await db
    .prepare(
      `SELECT EXISTS (SELECT 1 FROM expenses WHERE ledger_id = ?1 AND deleted_at IS NULL)
           OR EXISTS (SELECT 1 FROM settlements WHERE ledger_id = ?1 AND deleted_at IS NULL) AS active`,
    )
    .bind(ledgerId)
    .first<{ active: number }>();
  return row?.active === 1;
}

export async function updateLedger(
  db: D1Database,
  id: string,
  patch: { name?: string; baseCurrency?: string },
): Promise<void> {
  await db
    .prepare('UPDATE ledgers SET name = COALESCE(?, name), base_currency = COALESCE(?, base_currency) WHERE id = ?')
    .bind(patch.name ?? null, patch.baseCurrency ?? null, id)
    .run();
}

export async function listMembers(db: D1Database, ledgerId: string): Promise<MemberRow[]> {
  const { results } = await db
    .prepare(
      `SELECT m.*, p.info AS payment_info FROM members m
       LEFT JOIN payment_profiles p ON p.line_user_id = m.line_user_id
       WHERE m.ledger_id = ? ORDER BY m.joined_at, m.id`,
    )
    .bind(ledgerId)
    .all<MemberRow>();
  return results;
}

export function findMemberByLineUser(db: D1Database, ledgerId: string, lineUserId: string): Promise<MemberRow | null> {
  return db
    .prepare('SELECT * FROM members WHERE ledger_id = ? AND line_user_id = ?')
    .bind(ledgerId, lineUserId)
    .first<MemberRow>();
}

/** Revokes the user's access to every ledger of the group they just left. */
export async function markMemberLeft(db: D1Database, groupId: string, lineUserId: string, now = Date.now()) {
  await db
    .prepare(
      `UPDATE members SET left_at = ?
       WHERE line_user_id = ? AND left_at IS NULL
         AND ledger_id IN (SELECT id FROM ledgers WHERE line_group_id = ?)`,
    )
    .bind(now, lineUserId, groupId)
    .run();
}

/**
 * Adds a LINE user to the ledger, or refreshes their name/avatar if already a
 * member. Callers have checked the user is in the group, so this also restores
 * a member who had left.
 */
export async function upsertLineMember(
  db: D1Database,
  ledgerId: string,
  lineUserId: string,
  profile: { displayName: string; pictureUrl?: string | null },
): Promise<MemberRow> {
  await db
    .prepare(
      `INSERT INTO members (id, ledger_id, line_user_id, display_name, avatar_url, is_virtual, joined_at)
       VALUES (?, ?, ?, ?, ?, 0, ?)
       ON CONFLICT (ledger_id, line_user_id)
       DO UPDATE SET display_name = excluded.display_name, avatar_url = excluded.avatar_url, left_at = NULL`,
    )
    .bind(crypto.randomUUID(), ledgerId, lineUserId, profile.displayName, profile.pictureUrl ?? null, Date.now())
    .run();
  return (await findMemberByLineUser(db, ledgerId, lineUserId))!;
}
