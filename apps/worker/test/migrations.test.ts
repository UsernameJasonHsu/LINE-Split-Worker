import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Env } from '../src/env';
import { applyMigrations, createTestEnv, MIGRATIONS } from './helpers';

let env: Env;
let dispose: () => Promise<void>;

beforeAll(async () => {
  ({ env, dispose } = await createTestEnv({ migrate: false }));
}, 60_000);

afterAll(async () => {
  await dispose();
});

describe('0002_multiple_ledgers', () => {
  it('rebuilds ledgers without losing data or breaking foreign keys', async () => {
    await applyMigrations(env.DB, MIGRATIONS.filter((f) => f.startsWith('0001')));
    const db = env.DB;
    await db.batch([
      db.prepare(
        "INSERT INTO ledgers (id, line_group_id, name, base_currency, created_at, archived_at) VALUES ('L1', 'C1', '日本', 'TWD', 1, 5)",
      ),
      db.prepare("INSERT INTO members (id, ledger_id, line_user_id, display_name, joined_at) VALUES ('M1', 'L1', 'U1', 'A', 1)"),
      db.prepare(
        `INSERT INTO expenses (id, ledger_id, title, currency, amount_minor, fx_rate, fx_source, base_amount_minor,
           split_type, spent_at, created_by, created_at, updated_at, revision)
         VALUES ('E1', 'L1', 'x', 'TWD', 100, '1', 'NONE', 100, 'equal', 1, 'M1', 1, 1, 'r')`,
      ),
    ]);

    await applyMigrations(env.DB, MIGRATIONS.filter((f) => f.startsWith('0002')));

    expect(await db.prepare('SELECT * FROM ledgers').first()).toEqual({
      id: 'L1',
      line_group_id: 'C1',
      name: '日本',
      base_currency: 'TWD',
      created_at: 1,
      archived_at: 5,
      closed_at: null,
      successor_id: null,
    });
    expect((await db.prepare('SELECT COUNT(*) AS n FROM expenses').first<{ n: number }>())!.n).toBe(1);
    expect((await db.prepare('PRAGMA foreign_key_check').all()).results).toEqual([]);

    // Only one open ledger per group; closed ones may repeat the group.
    await db.prepare('UPDATE ledgers SET closed_at = 2 WHERE id = ?').bind('L1').run();
    await db.prepare("INSERT INTO ledgers (id, line_group_id, name, created_at) VALUES ('L2', 'C1', '韓國', 3)").run();
    await expect(
      db.prepare("INSERT INTO ledgers (id, line_group_id, name, created_at) VALUES ('L3', 'C1', '泰國', 4)").run(),
    ).rejects.toThrow(/UNIQUE/);
  });
});
