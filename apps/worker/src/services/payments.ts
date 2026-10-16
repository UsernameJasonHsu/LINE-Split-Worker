export async function getPaymentInfo(db: D1Database, lineUserId: string): Promise<string | null> {
  const row = await db
    .prepare('SELECT info FROM payment_profiles WHERE line_user_id = ?')
    .bind(lineUserId)
    .first<{ info: string }>();
  return row?.info ?? null;
}

/** Saves the user's own payment details; an empty string clears them. */
export async function setPaymentInfo(db: D1Database, lineUserId: string, info: string): Promise<string | null> {
  if (info === '') {
    await db.prepare('DELETE FROM payment_profiles WHERE line_user_id = ?').bind(lineUserId).run();
    return null;
  }
  await db
    .prepare(
      `INSERT INTO payment_profiles (line_user_id, info, updated_at) VALUES (?, ?, ?)
       ON CONFLICT (line_user_id) DO UPDATE SET info = excluded.info, updated_at = excluded.updated_at`,
    )
    .bind(lineUserId, info, Date.now())
    .run();
  return info;
}
