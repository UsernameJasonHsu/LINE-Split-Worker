import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { Env } from '../src/env';
import { DAILY_SERIES_DAYS, dayKey, recordVisit } from '../src/services/userStats';
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
