import { HttpError } from '../errors';
import type { FeedbackBody, FEEDBACK_CATEGORIES, FEEDBACK_STATUSES } from '../schemas';

export type FeedbackCategory = (typeof FEEDBACK_CATEGORIES)[number];
export type FeedbackStatus = (typeof FEEDBACK_STATUSES)[number];

export const CATEGORY_LABELS: Record<FeedbackCategory, string> = {
  bug: '問題回報',
  idea: '功能建議',
  other: '其他',
};

const DAILY_LIMIT = 10;

export interface FeedbackDto {
  id: string;
  category: FeedbackCategory;
  message: string;
  status: FeedbackStatus;
  adminNote: string | null;
  createdAt: number;
  updatedAt: number;
}

export interface AdminFeedbackDto extends FeedbackDto {
  displayName: string;
  ledgerId: string | null;
  ledgerName: string | null;
  context: Record<string, unknown> | null;
}

interface FeedbackRow {
  id: string;
  line_user_id: string;
  display_name: string;
  ledger_id: string | null;
  ledger_name?: string | null;
  category: FeedbackCategory;
  message: string;
  context_json: string | null;
  status: FeedbackStatus;
  admin_note: string | null;
  created_at: number;
  updated_at: number;
}

const toDto = (r: FeedbackRow): FeedbackDto => ({
  id: r.id,
  category: r.category,
  message: r.message,
  status: r.status,
  adminNote: r.admin_note,
  createdAt: r.created_at,
  updatedAt: r.updated_at,
});

/** The submitter's view: drops admin-only fields. */
export const toPublicFeedback = ({ id, category, message, status, adminNote, createdAt, updatedAt }: FeedbackDto) => ({
  id,
  category,
  message,
  status,
  adminNote,
  createdAt,
  updatedAt,
});

const toAdminDto = (r: FeedbackRow): AdminFeedbackDto => ({
  ...toDto(r),
  displayName: r.display_name,
  ledgerId: r.ledger_id,
  ledgerName: r.ledger_name ?? null,
  context: r.context_json ? (JSON.parse(r.context_json) as Record<string, unknown>) : null,
});

const SELECT_WITH_LEDGER = `SELECT f.*, l.name AS ledger_name FROM feedback f LEFT JOIN ledgers l ON l.id = f.ledger_id`;

export async function createFeedback(
  db: D1Database,
  user: { lineUserId: string; displayName: string },
  body: FeedbackBody,
): Promise<AdminFeedbackDto> {
  const now = Date.now();
  const recent = await db
    .prepare('SELECT COUNT(*) AS n FROM feedback WHERE line_user_id = ? AND created_at > ?')
    .bind(user.lineUserId, now - 24 * 3600_000)
    .first<{ n: number }>();
  if ((recent?.n ?? 0) >= DAILY_LIMIT) throw new HttpError(429, 'Too much feedback today; please try again tomorrow');

  const id = crypto.randomUUID();
  await db
    .prepare(
      `INSERT INTO feedback (id, line_user_id, display_name, ledger_id, category, message, context_json, status, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, 'new', ?, ?)`,
    )
    .bind(
      id,
      user.lineUserId,
      user.displayName,
      body.ledgerId ?? null,
      body.category,
      body.message,
      body.context ? JSON.stringify(body.context) : null,
      now,
      now,
    )
    .run();
  return (await getFeedback(db, id))!;
}

export async function getFeedback(db: D1Database, id: string): Promise<AdminFeedbackDto | null> {
  const row = await db.prepare(`${SELECT_WITH_LEDGER} WHERE f.id = ?`).bind(id).first<FeedbackRow>();
  return row ? toAdminDto(row) : null;
}

export async function listMyFeedback(db: D1Database, lineUserId: string): Promise<FeedbackDto[]> {
  const { results } = await db
    .prepare('SELECT * FROM feedback WHERE line_user_id = ? ORDER BY created_at DESC, rowid DESC LIMIT 50')
    .bind(lineUserId)
    .all<FeedbackRow>();
  return results.map(toDto);
}

export async function listAllFeedback(db: D1Database, status?: FeedbackStatus): Promise<AdminFeedbackDto[]> {
  const stmt = status
    ? db.prepare(`${SELECT_WITH_LEDGER} WHERE f.status = ? ORDER BY f.created_at DESC, f.rowid DESC LIMIT 200`).bind(status)
    : db.prepare(`${SELECT_WITH_LEDGER} ORDER BY f.created_at DESC, f.rowid DESC LIMIT 200`);
  const { results } = await stmt.all<FeedbackRow>();
  return results.map(toAdminDto);
}

export async function updateFeedback(
  db: D1Database,
  id: string,
  patch: { status?: FeedbackStatus; adminNote?: string | null },
): Promise<AdminFeedbackDto> {
  const note = patch.adminNote === undefined ? undefined : patch.adminNote || null;
  const result = await db
    .prepare(
      `UPDATE feedback SET
         status = COALESCE(?, status),
         admin_note = CASE WHEN ? THEN ? ELSE admin_note END,
         updated_at = ?
       WHERE id = ?`,
    )
    .bind(patch.status ?? null, note !== undefined ? 1 : 0, note ?? null, Date.now(), id)
    .run();
  if (result.meta.changes === 0) throw new HttpError(404, 'Feedback not found');
  return (await getFeedback(db, id))!;
}

/** Plain-text notification pushed to admins for a new piece of feedback. */
export function feedbackNotice(f: AdminFeedbackDto, adminUrl: string): string {
  const excerpt = f.message.length > 300 ? `${f.message.slice(0, 300)}…` : f.message;
  return [
    `📝 新回饋（${CATEGORY_LABELS[f.category]}）`,
    `來自：${f.displayName}${f.ledgerName ? `（${f.ledgerName}）` : ''}`,
    '',
    excerpt,
    '',
    `管理回饋：${adminUrl}`,
  ].join('\n');
}
