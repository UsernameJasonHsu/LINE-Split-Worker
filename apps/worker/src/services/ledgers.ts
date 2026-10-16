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

/**
 * Closes `ledger` and opens a new one for the same group, copying its members.
 * The follow-up inserts are guarded on the successor id written by the close,
 * so a concurrent close turns the whole batch into a no-op. Returns the new
 * ledger id, or null if the ledger was already closed.
 */
export async function closeAndStartNext(db: D1Database, ledger: LedgerRow, name: string): Promise<string | null> {
  const nextId = crypto.randomUUID();
  const now = Date.now();
  const [closed] = await db.batch([
    db
      .prepare('UPDATE ledgers SET closed_at = ?, successor_id = ? WHERE id = ? AND closed_at IS NULL')
      .bind(now, nextId, ledger.id),
    db
      .prepare(
        `INSERT INTO ledgers (id, line_group_id, name, base_currency, created_at, archived_at)
         SELECT ?, line_group_id, ?, base_currency, ?, archived_at FROM ledgers WHERE id = ? AND successor_id = ?`,
      )
      .bind(nextId, name, now, ledger.id, nextId),
    db
      .prepare(
        `INSERT INTO members (id, ledger_id, line_user_id, display_name, avatar_url, is_virtual, joined_at)
         SELECT lower(hex(randomblob(16))), ?, line_user_id, display_name, avatar_url, is_virtual, joined_at
         FROM members
         WHERE ledger_id = ? AND EXISTS (SELECT 1 FROM ledgers WHERE id = ? AND successor_id = ?)`,
      )
      .bind(nextId, ledger.id, ledger.id, nextId),
  ]);
  return closed!.meta.changes === 0 ? null : nextId;
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
         EXISTS (SELECT 1 FROM members m WHERE m.ledger_id = l.id AND m.line_user_id = ?) AS is_member
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
    .prepare('SELECT * FROM members WHERE ledger_id = ? ORDER BY joined_at, id')
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

/** Adds a LINE user to the ledger, or refreshes their name/avatar if already a member. */
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
       DO UPDATE SET display_name = excluded.display_name, avatar_url = excluded.avatar_url`,
    )
    .bind(crypto.randomUUID(), ledgerId, lineUserId, profile.displayName, profile.pictureUrl ?? null, Date.now())
    .run();
  return (await findMemberByLineUser(db, ledgerId, lineUserId))!;
}
