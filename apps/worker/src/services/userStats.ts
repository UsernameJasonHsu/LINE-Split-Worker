/** Days are counted in Taiwan time so "today" matches what the admin sees. */
const TZ_OFFSET_MS = 8 * 60 * 60 * 1000;
const DAY_MS = 24 * 60 * 60 * 1000;
/** How many days the daily-activity series covers (including today). */
export const DAILY_SERIES_DAYS = 30;

export const dayKey = (ts: number) => new Date(ts + TZ_OFFSET_MS).toISOString().slice(0, 10);

/** Counts one app open for the user today. */
export async function recordVisit(db: D1Database, lineUserId: string, now = Date.now()): Promise<void> {
  await db
    .prepare(
      `INSERT INTO user_visits (line_user_id, day, opens, last_at) VALUES (?, ?, 1, ?)
       ON CONFLICT (line_user_id, day) DO UPDATE SET opens = opens + 1, last_at = excluded.last_at`,
    )
    .bind(lineUserId, dayKey(now), now)
    .run();
}

export interface UserStatDto {
  lineUserId: string;
  displayName: string;
  avatarUrl: string | null;
  /** Ledgers the user is a member of, and how many of those are still open. */
  ledgers: number;
  openLedgers: number;
  /** Expenses the user recorded (not deleted), and how many via the one-line input. */
  expenses: number;
  sentenceExpenses: number;
  /** Create/update/delete actions on expenses and settlements. */
  actions: number;
  feedback: number;
  /** App opens and distinct days with an open (only since visit tracking began). */
  opens: number;
  activeDays: number;
  firstSeenAt: number | null;
  lastActiveAt: number | null;
}

export interface EntrySession {
  outcome: 'saved' | 'abandoned';
  source: 'form' | 'sentence';
  durationMs: number;
  taps: number;
}

/** Records one visit to the new-expense form. */
export async function recordEntrySession(
  db: D1Database,
  ledgerId: string,
  lineUserId: string,
  s: EntrySession,
  now = Date.now(),
): Promise<void> {
  await db
    .prepare(
      `INSERT INTO entry_sessions (ledger_id, line_user_id, outcome, source, duration_ms, taps, at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
    )
    .bind(ledgerId, lineUserId, s.outcome, s.source, s.durationMs, s.taps, now)
    .run();
}

export interface EntryStatDto {
  saved: number;
  abandoned: number;
  /** Medians over saved sessions; null when there are none. */
  medianSeconds: number | null;
  medianTaps: number | null;
}

/** Middle value (mean of the two middle ones for an even count); null for none. */
export function median(xs: number[]): number | null {
  if (xs.length === 0) return null;
  const sorted = [...xs].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid]! : (sorted[mid - 1]! + sorted[mid]!) / 2;
}

function entryStats(rows: { outcome: string; source: string; duration_ms: number; taps: number }[]) {
  const of = (source: string): EntryStatDto => {
    const mine = rows.filter((r) => r.source === source);
    const saved = mine.filter((r) => r.outcome === 'saved');
    const ms = median(saved.map((r) => r.duration_ms));
    return {
      saved: saved.length,
      abandoned: mine.length - saved.length,
      medianSeconds: ms === null ? null : Math.round(ms / 100) / 10,
      medianTaps: median(saved.map((r) => r.taps)),
    };
  };
  return { form: of('form'), sentence: of('sentence') };
}

export interface UserStatsDto {
  users: UserStatDto[];
  /** New-expense form sessions over the last DAILY_SERIES_DAYS days, by how the expense was entered. */
  entry: { form: EntryStatDto; sentence: EntryStatDto };
  /** Distinct users and opens per day, oldest first, for the last DAILY_SERIES_DAYS days. */
  daily: { day: string; users: number; opens: number }[];
  /** First day with recorded opens (null if none yet). */
  trackingSince: string | null;
}

interface UserRow {
  line_user_id: string;
  display_name: string | null;
  avatar_url: string | null;
  ledgers: number | null;
  open_ledgers: number | null;
  first_joined_at: number | null;
  expenses: number | null;
  sentence_expenses: number | null;
  actions: number | null;
  last_action_at: number | null;
  feedback: number | null;
  feedback_name: string | null;
  first_feedback_at: number | null;
  opens: number | null;
  active_days: number | null;
  last_visit_at: number | null;
}

const known = (xs: (number | null)[]) => xs.filter((x): x is number => x !== null);
const maxOrNull = (...xs: (number | null)[]) => (known(xs).length ? Math.max(...known(xs)) : null);
const minOrNull = (...xs: (number | null)[]) => (known(xs).length ? Math.min(...known(xs)) : null);

export async function getUserStats(db: D1Database, now = Date.now()): Promise<UserStatsDto> {
  const since = dayKey(now - (DAILY_SERIES_DAYS - 1) * DAY_MS);
  const [users, daily, tracking, sessions] = await db.batch([
    db.prepare(
      `WITH ids AS (
         SELECT line_user_id FROM members WHERE line_user_id IS NOT NULL
         UNION SELECT line_user_id FROM feedback
         UNION SELECT line_user_id FROM user_visits
       ),
       mem AS (
         SELECT m.line_user_id, COUNT(*) AS ledgers, SUM(l.closed_at IS NULL) AS open_ledgers,
                MIN(m.joined_at) AS first_joined_at
         FROM members m JOIN ledgers l ON l.id = m.ledger_id
         WHERE m.line_user_id IS NOT NULL GROUP BY m.line_user_id
       ),
       latest AS (
         SELECT line_user_id, display_name, avatar_url,
                ROW_NUMBER() OVER (PARTITION BY line_user_id ORDER BY joined_at DESC) AS rn
         FROM members WHERE line_user_id IS NOT NULL
       ),
       exp AS (
         SELECT m.line_user_id, COUNT(*) AS expenses, SUM(e.source = 'sentence') AS sentence_expenses
         FROM expenses e JOIN members m ON m.id = e.created_by
         WHERE e.deleted_at IS NULL GROUP BY m.line_user_id
       ),
       act AS (
         SELECT m.line_user_id, COUNT(*) AS actions, MAX(a.at) AS last_action_at
         FROM audit_logs a JOIN members m ON m.id = a.actor_member_id GROUP BY m.line_user_id
       ),
       fb AS (
         SELECT line_user_id, COUNT(*) AS feedback, MAX(display_name) AS feedback_name,
                MIN(created_at) AS first_feedback_at
         FROM feedback GROUP BY line_user_id
       ),
       vis AS (
         SELECT line_user_id, SUM(opens) AS opens, COUNT(*) AS active_days, MAX(last_at) AS last_visit_at
         FROM user_visits GROUP BY line_user_id
       )
       SELECT ids.line_user_id, latest.display_name, latest.avatar_url,
              mem.ledgers, mem.open_ledgers, mem.first_joined_at,
              exp.expenses, exp.sentence_expenses, act.actions, act.last_action_at,
              fb.feedback, fb.feedback_name, fb.first_feedback_at,
              vis.opens, vis.active_days, vis.last_visit_at
       FROM ids
       LEFT JOIN latest ON latest.line_user_id = ids.line_user_id AND latest.rn = 1
       LEFT JOIN mem ON mem.line_user_id = ids.line_user_id
       LEFT JOIN exp ON exp.line_user_id = ids.line_user_id
       LEFT JOIN act ON act.line_user_id = ids.line_user_id
       LEFT JOIN fb ON fb.line_user_id = ids.line_user_id
       LEFT JOIN vis ON vis.line_user_id = ids.line_user_id`,
    ),
    db
      .prepare(
        `SELECT day, COUNT(*) AS users, SUM(opens) AS opens FROM user_visits
         WHERE day >= ? GROUP BY day ORDER BY day`,
      )
      .bind(since),
    db.prepare('SELECT MIN(day) AS since FROM user_visits'),
    db
      .prepare('SELECT outcome, source, duration_ms, taps FROM entry_sessions WHERE at >= ?')
      .bind(now - DAILY_SERIES_DAYS * DAY_MS),
  ]);

  const byDay = new Map((daily!.results as UserStatsDto['daily']).map((r) => [r.day, r]));
  return {
    users: (users!.results as UserRow[]).map((r) => ({
      lineUserId: r.line_user_id,
      displayName: r.display_name ?? r.feedback_name ?? 'LINE 使用者',
      avatarUrl: r.avatar_url,
      ledgers: r.ledgers ?? 0,
      openLedgers: r.open_ledgers ?? 0,
      expenses: r.expenses ?? 0,
      sentenceExpenses: r.sentence_expenses ?? 0,
      actions: r.actions ?? 0,
      feedback: r.feedback ?? 0,
      opens: r.opens ?? 0,
      activeDays: r.active_days ?? 0,
      firstSeenAt: minOrNull(r.first_joined_at, r.first_feedback_at),
      lastActiveAt: maxOrNull(r.last_action_at, r.last_visit_at),
    })),
    daily: Array.from({ length: DAILY_SERIES_DAYS }, (_, i) => {
      const day = dayKey(now - (DAILY_SERIES_DAYS - 1 - i) * DAY_MS);
      const row = byDay.get(day);
      return { day, users: row?.users ?? 0, opens: row?.opens ?? 0 };
    }),
    trackingSince: (tracking!.results[0] as { since: string | null } | undefined)?.since ?? null,
    entry: entryStats(sessions!.results as Parameters<typeof entryStats>[0]),
  };
}
