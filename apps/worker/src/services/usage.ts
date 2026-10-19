import type { LineClient } from '../line/client';

/** Cloudflare D1 free plan: max size of a single database. */
const D1_DATABASE_LIMIT_BYTES = 500 * 1024 * 1024;

export interface UsageDto {
  database: {
    /** Current database size reported by D1 (null if unavailable). */
    sizeBytes: number | null;
    limitBytes: number;
    counts: { ledgers: number; users: number; expenses: number; feedback: number };
    /** Expenses by how they were entered (only those recorded since tracking began). */
    expenseSources: { form: number; sentence: number; chat: number };
  };
  /** LINE push messages this month; null if the LINE API could not be reached. */
  line: { quota: number | null; used: number } | null;
  links: { workers: string; d1: string; lineManager: string };
}

export async function getUsage(db: D1Database, line: LineClient): Promise<UsageDto> {
  const [counts, sources, push] = await Promise.all([
    db
      .prepare(
        `SELECT
           (SELECT COUNT(*) FROM ledgers) AS ledgers,
           (SELECT COUNT(DISTINCT line_user_id) FROM members WHERE line_user_id IS NOT NULL) AS users,
           (SELECT COUNT(*) FROM expenses WHERE deleted_at IS NULL) AS expenses,
           (SELECT COUNT(*) FROM feedback) AS feedback`,
      )
      .all<UsageDto['database']['counts']>(),
    db
      .prepare(
        `SELECT source, COUNT(*) AS n FROM expenses
         WHERE deleted_at IS NULL AND source IS NOT NULL GROUP BY source`,
      )
      .all<{ source: string; n: number }>(),
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
      expenseSources: Object.fromEntries(
        (['form', 'sentence', 'chat'] as const).map((k) => [k, sources.results.find((r) => r.source === k)?.n ?? 0]),
      ) as UsageDto['database']['expenseSources'],
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
