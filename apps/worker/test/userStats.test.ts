import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { Env } from '../src/env';
import { DAILY_SERIES_DAYS, dayKey, median, recordEntrySession, recordVisit } from '../src/services/userStats';
import { apiRequest, callApp, createTestEnv, installFakeExternal, signedWebhook } from './helpers';

let env: Env;
let dispose: () => Promise<void>;
let reset: () => Promise<void>;
let fake: ReturnType<typeof installFakeExternal>;

beforeAll(async () => {
  ({ env, dispose, reset } = await createTestEnv());
}, 60_000);

afterAll(async () => {
  await dispose();
});

beforeEach(async () => {
  await reset();
  fake = installFakeExternal();
  fake.idTokens.set('token-alice', { sub: 'Ualice', name: 'Alice' });
  fake.idTokens.set('token-bob', { sub: 'Ubob', name: 'Bob' });
  fake.idTokens.set('token-admin', { sub: 'Uadmin', name: 'Owner' });
});

async function api(method: string, path: string, token?: string, body?: unknown) {
  const res = await callApp(env, apiRequest(method, path, token, body));
  const text = await res.text();
  return { status: res.status, body: text ? JSON.parse(text) : null };
}

describe('dayKey', () => {
  it('uses Taiwan time', () => {
    expect(dayKey(Date.UTC(2026, 9, 21, 15, 59))).toBe('2026-10-21');
    expect(dayKey(Date.UTC(2026, 9, 21, 16, 0))).toBe('2026-10-22');
  });
});

describe('median', () => {
  it('takes the middle value, averaging the two middle ones', () => {
    expect(median([])).toBeNull();
    expect(median([9, 1, 5])).toBe(5);
    expect(median([4, 1, 3, 2])).toBe(2.5);
  });
});

describe('POST /api/ledgers/:id/entry-sessions', () => {
  async function ledgerWithAlice() {
    await callApp(env, signedWebhook([{ type: 'join', replyToken: 'rt', source: { type: 'group', groupId: 'C1' } }]));
    const ledgerId = (await env.DB.prepare('SELECT id FROM ledgers').first<{ id: string }>())!.id;
    await api('POST', `/ledgers/${ledgerId}/join`, 'token-alice');
    return ledgerId;
  }

  it('records a session for members only and validates it', async () => {
    const ledgerId = await ledgerWithAlice();
    const session = { outcome: 'saved', source: 'form', durationMs: 8200, taps: 6 };
    expect((await api('POST', `/ledgers/${ledgerId}/entry-sessions`, 'token-alice', session)).status).toBe(204);
    expect((await api('POST', `/ledgers/${ledgerId}/entry-sessions`, 'token-bob', session)).status).toBe(403);
    expect(
      (await api('POST', `/ledgers/${ledgerId}/entry-sessions`, 'token-alice', { ...session, outcome: 'maybe' })).status,
    ).toBe(400);
    expect(
      (await api('POST', `/ledgers/${ledgerId}/entry-sessions`, 'token-alice', { ...session, taps: -1 })).status,
    ).toBe(400);

    const row = await env.DB.prepare('SELECT * FROM entry_sessions').first();
    expect(row).toMatchObject({ ledger_id: ledgerId, line_user_id: 'Ualice', outcome: 'saved', duration_ms: 8200, taps: 6 });
  });

  it('summarises the last 30 days by entry mode on the admin page', async () => {
    const ledgerId = await ledgerWithAlice();
    const day = 24 * 60 * 60 * 1000;
    const add = (outcome: 'saved' | 'abandoned', source: 'form' | 'sentence', durationMs: number, taps: number, at = Date.now()) =>
      recordEntrySession(env.DB, ledgerId, 'Ualice', { outcome, source, durationMs, taps }, at);
    await add('saved', 'form', 10_000, 8);
    await add('saved', 'form', 20_000, 4);
    await add('saved', 'form', 12_340, 6);
    await add('abandoned', 'form', 3_000, 2);
    await add('saved', 'sentence', 7_000, 2);
    await add('saved', 'form', 99_000, 99, Date.now() - 31 * day); // too old

    const { entry } = (await api('GET', '/admin/users', 'token-admin')).body;
    expect(entry).toEqual({
      form: { saved: 3, abandoned: 1, medianSeconds: 12.3, medianTaps: 6 },
      sentence: { saved: 1, abandoned: 0, medianSeconds: 7, medianTaps: 2 },
    });
  });

  it('reports no medians before anything is saved', async () => {
    const { entry } = (await api('GET', '/admin/users', 'token-admin')).body;
    expect(entry.form).toEqual({ saved: 0, abandoned: 0, medianSeconds: null, medianTaps: null });
  });
});

describe('GET /api/admin/users', () => {
  it('is admin-only', async () => {
    expect((await api('GET', '/admin/users', 'token-alice')).status).toBe(403);
    expect((await api('GET', '/admin/users')).status).toBe(401);
  });

  it('counts opens per user and day from the first load only', async () => {
    await callApp(env, signedWebhook([{ type: 'join', replyToken: 'rt', source: { type: 'group', groupId: 'C1' } }]));
    const ledgerId = (await env.DB.prepare('SELECT id FROM ledgers').first<{ id: string }>())!.id;
    await api('POST', `/ledgers/${ledgerId}/open?visit=1`, 'token-alice');
    await api('POST', `/ledgers/${ledgerId}/open?visit=1`, 'token-alice');
    await api('POST', `/ledgers/${ledgerId}/open`, 'token-alice'); // reload after a change
    await api('GET', '/me', 'token-alice');
    await api('POST', `/ledgers/${ledgerId}/open?visit=1`, 'token-bob');

    const stats = (await api('GET', '/admin/users', 'token-admin')).body;
    const alice = stats.users.find((u: { lineUserId: string }) => u.lineUserId === 'Ualice');
    expect(alice).toMatchObject({ opens: 2, activeDays: 1, displayName: 'Alice' });
    expect(alice.lastActiveAt).toEqual(expect.any(Number));
    expect(stats.daily).toHaveLength(DAILY_SERIES_DAYS);
    expect(stats.daily.at(-1)).toEqual({ day: dayKey(Date.now()), users: 2, opens: 3 });
    expect(stats.trackingSince).toBe(dayKey(Date.now()));
  });

  it('reports ledgers, expenses, actions and feedback per user', async () => {
    await callApp(env, signedWebhook([{ type: 'join', replyToken: 'rt', source: { type: 'group', groupId: 'C1' } }]));
    const ledgerId = (await env.DB.prepare('SELECT id FROM ledgers').first<{ id: string }>())!.id;
    const alice = (await api('POST', `/ledgers/${ledgerId}/join`, 'token-alice')).body.meMemberId;
    await api('POST', `/ledgers/${ledgerId}/join`, 'token-bob');
    const expense = (source: string) => ({
      title: 'x',
      currency: 'TWD',
      amount: '100',
      payers: [{ memberId: alice, amount: '100' }],
      split: { type: 'equal', memberIds: [alice] },
      source,
    });
    await api('POST', `/ledgers/${ledgerId}/expenses`, 'token-alice', expense('sentence'));
    const deleted = (await api('POST', `/ledgers/${ledgerId}/expenses`, 'token-alice', expense('form'))).body;
    await api('DELETE', `/ledgers/${ledgerId}/expenses/${deleted.id}`, 'token-alice');
    await api('POST', '/feedback', 'token-bob', { category: 'idea', message: 'hi' });
    await recordVisit(env.DB, 'Ubob', Date.now() - 3 * 24 * 60 * 60 * 1000);

    const { users } = (await api('GET', '/admin/users', 'token-admin')).body;
    const byId = Object.fromEntries(users.map((u: { lineUserId: string }) => [u.lineUserId, u]));
    expect(byId.Ualice).toMatchObject({
      displayName: 'Alice',
      ledgers: 1,
      openLedgers: 1,
      expenses: 1,
      sentenceExpenses: 1,
      actions: 3,
      feedback: 0,
      opens: 0,
    });
    expect(byId.Ubob).toMatchObject({ displayName: 'Bob', ledgers: 1, expenses: 0, feedback: 1, opens: 1 });
    expect(byId.Ubob.firstSeenAt).toEqual(expect.any(Number));
    expect(Object.keys(byId)).not.toContain('Uadmin');
  });
});
