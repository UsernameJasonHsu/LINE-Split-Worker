import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { Env } from '../src/env';
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
  fake.idTokens.set('token-admin', { sub: 'Uadmin', name: 'Owner' });
});

async function api(method: string, path: string, token?: string, body?: unknown) {
  const res = await callApp(env, apiRequest(method, path, token, body));
  const text = await res.text();
  return { status: res.status, body: text ? JSON.parse(text) : null };
}

describe('GET /api/admin/usage', () => {
  it('is admin-only', async () => {
    expect((await api('GET', '/admin/usage', 'token-alice')).status).toBe(403);
    expect((await api('GET', '/admin/usage')).status).toBe(401);
  });

  it('reports database size, record counts and LINE push usage', async () => {
    await callApp(env, signedWebhook([{ type: 'join', replyToken: 'rt', source: { type: 'group', groupId: 'C1' } }]));
    const ledgerId = (await env.DB.prepare('SELECT id FROM ledgers').first<{ id: string }>())!.id;
    const alice = (await api('POST', `/ledgers/${ledgerId}/join`, 'token-alice')).body.meMemberId;
    await api('POST', `/ledgers/${ledgerId}/expenses`, 'token-alice', {
      title: 'x',
      currency: 'TWD',
      amount: '100',
      payers: [{ memberId: alice, amount: '100' }],
      split: { type: 'equal', memberIds: [alice] },
      source: 'sentence',
    });
    await api('POST', '/feedback', 'token-alice', { category: 'idea', message: 'hi' });
    fake.lineQuota.used = 150;

    const usage = (await api('GET', '/admin/usage', 'token-admin')).body;
    expect(usage.database).toMatchObject({
      limitBytes: 500 * 1024 * 1024,
      counts: { ledgers: 1, users: 1, expenses: 1, feedback: 1 },
      expenseSources: { form: 0, sentence: 1 },
    });
    expect(usage.database.sizeBytes).toEqual(expect.any(Number));
    expect(usage.line).toEqual({ quota: 200, used: 150 });
    expect(usage.links.workers).toContain('dash.cloudflare.com');
  });

  it('reports an unlimited plan and survives LINE API failures', async () => {
    fake.lineQuota.value = null;
    expect((await api('GET', '/admin/usage', 'token-admin')).body.line).toEqual({ quota: null, used: 2 });

    fake.lineQuota.fail = true;
    const usage = await api('GET', '/admin/usage', 'token-admin');
    expect(usage.status).toBe(200);
    expect(usage.body.line).toBeNull();
    expect(usage.body.database.counts.ledgers).toBe(0);
  });
});
