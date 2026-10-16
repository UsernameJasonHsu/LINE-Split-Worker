import type { LineClient } from '../line/client';

/** Cloudflare D1 free plan: max size of a single database. */
const D1_DATABASE_LIMIT_BYTES = 500 * 1024 * 1024;

export interface UsageDto {
  database: {
    /** Current database size reported by D1 (null if unavailable). */
    sizeBytes: number | null;
    limitBytes: number;
    counts: { ledgers: number; users: number; expenses: number; feedback: number };
  };
  /** LINE push messages this month; null if the LINE API could not be reached. */
  line: { quota: number | null; used: number } | null;
  links: { workers: string; d1: string; lineManager: string };
}

export async function getUsage(db: D1Database, line: LineClient): Promise<UsageDto> {
  const [counts, push] = await Promise.all([
    db
      .prepare(
        `SELECT
           (SELECT COUNT(*) FROM ledgers) AS ledgers,
           (SELECT COUNT(DISTINCT line_user_id) FROM members WHERE line_user_id IS NOT NULL) AS users,
           (SELECT COUNT(*) FROM expenses WHERE deleted_at IS NULL) AS expenses,
           (SELECT COUNT(*) FROM feedback) AS feedback`,
      )
      .all<UsageDto['database']['counts']>(),
    line.getPushQuota().catch((err) => {
      console.error('Failed to read LINE push quota', err);
      return null;
    }),
  ]);

  return {
    database: {
      sizeBytes: typeof counts.meta.size_after === 'number' ? counts.meta.size_after : null,
      limitBytes: D1_DATABASE_LIMIT_BYTES,
      counts: counts.results[0]!,
    },
    line: push,
    links: {
      // `:account` lets the dashboard pick the signed-in account.
      workers: 'https://dash.cloudflare.com/?to=/:account/workers-and-pages',
      d1: 'https://dash.cloudflare.com/?to=/:account/workers/d1',
      lineManager: 'https://manager.line.biz/',
    },
  };
}
