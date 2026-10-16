export interface LedgerRow {
  id: string;
  line_group_id: string | null;
  name: string;
  base_currency: string;
  created_at: number;
  archived_at: number | null;
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

export function findLedgerByGroup(db: D1Database, groupId: string): Promise<LedgerRow | null> {
  return db.prepare('SELECT * FROM ledgers WHERE line_group_id = ?').bind(groupId).first<LedgerRow>();
}

/** Returns the group's ledger, creating (or un-archiving) it as needed. */
export async function ensureGroupLedger(
  db: D1Database,
  groupId: string,
  loadName: () => Promise<string>,
): Promise<LedgerRow> {
  const existing = await findLedgerByGroup(db, groupId);
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
       VALUES (?, ?, ?, 'TWD', ?) ON CONFLICT (line_group_id) DO NOTHING`,
    )
    .bind(crypto.randomUUID(), groupId, await loadName(), Date.now())
    .run();
  // Re-read so a concurrent insert for the same group resolves to one ledger.
  return (await findLedgerByGroup(db, groupId))!;
}

export async function archiveGroupLedger(db: D1Database, groupId: string): Promise<void> {
  await db
    .prepare('UPDATE ledgers SET archived_at = ? WHERE line_group_id = ? AND archived_at IS NULL')
    .bind(Date.now(), groupId)
    .run();
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
