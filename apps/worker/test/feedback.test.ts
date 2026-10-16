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
  fake.idTokens.set('token-bob', { sub: 'Ubob', name: 'Bob' });
  fake.idTokens.set('token-admin', { sub: 'Uadmin', name: 'Owner' });
});

async function api(method: string, path: string, token?: string, body?: unknown, e: Env = env) {
  const res = await callApp(e, apiRequest(method, path, token, body));
  const text = await res.text();
  return { status: res.status, body: text ? JSON.parse(text) : null };
}

const send = (token: string, body: object) => api('POST', '/feedback', token, body);

describe('submitting feedback', () => {
  it('stores feedback and notifies every admin by push', async () => {
    const res = await send('token-alice', { category: 'bug', message: '  日期欄位跑版  ', context: { page: 'expense' } });
    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({ category: 'bug', message: '日期欄位跑版', status: 'new', adminNote: null });

    expect(fake.pushes.map((p) => p.to)).toEqual(['Uadmin', 'Uother-admin']);
    const text = fake.pushes[0]!.messages[0].text as string;
    expect(text).toContain('問題回報');
    expect(text).toContain('Alice');
    expect(text).toContain('日期欄位跑版');
  });

  it('records the ledger name when sent from a ledger', async () => {
    await callApp(env, signedWebhook([{ type: 'join', replyToken: 'rt', source: { type: 'group', groupId: 'C1' } }]));
    const ledgerId = (await env.DB.prepare('SELECT id FROM ledgers').first<{ id: string }>())!.id;
    await send('token-alice', { category: 'idea', message: '想要匯出', ledgerId });
    const list = (await api('GET', '/admin/feedback', 'token-admin')).body.feedback;
    expect(list[0]).toMatchObject({ ledgerName: '日本旅行', displayName: 'Alice' });
  });

  it('skips the push when notifications are off', async () => {
    await send('token-alice', { category: 'other', message: 'hi' }).then(() => undefined);
    fake.pushes.length = 0;
    await api('POST', '/feedback', 'token-alice', { category: 'other', message: 'quiet' }, { ...env, FEEDBACK_PUSH: 'off' });
    expect(fake.pushes).toEqual([]);
  });

  it('still saves feedback if the push fails', async () => {
    const quietEnv = { ...env, ADMIN_LINE_USER_IDS: 'Ubroken' };
    const realFetch = (await import('../src/http')).http.fetch;
    (await import('../src/http')).http.fetch = async (input, init) =>
      String(input).endsWith('/push') ? new Response('quota', { status: 429 }) : realFetch(input, init);
    const res = await api('POST', '/feedback', 'token-alice', { category: 'bug', message: 'x' }, quietEnv);
    expect(res.status).toBe(201);
  });

  it('validates input', async () => {
    expect((await send('token-alice', { category: 'bug', message: '   ' })).status).toBe(400);
    expect((await send('token-alice', { category: 'rant', message: 'x' })).status).toBe(400);
    expect((await send('token-alice', { category: 'bug', message: 'x'.repeat(1001) })).status).toBe(400);
    expect((await api('POST', '/feedback', undefined, { category: 'bug', message: 'x' })).status).toBe(401);
  });

  it('limits each user to 10 per 24 hours', async () => {
    for (let i = 0; i < 10; i++) expect((await send('token-alice', { category: 'other', message: `#${i}` })).status).toBe(201);
    expect((await send('token-alice', { category: 'other', message: 'one more' })).status).toBe(429);
    expect((await send('token-bob', { category: 'other', message: 'bob is fine' })).status).toBe(201);
  });
});

describe('my feedback', () => {
  it('lists only my own feedback, newest first, with admin replies', async () => {
    const first = (await send('token-alice', { category: 'bug', message: 'first' })).body;
    await send('token-alice', { category: 'idea', message: 'second' });
    await send('token-bob', { category: 'bug', message: 'not mine' });
    await api('PATCH', `/admin/feedback/${first.id}`, 'token-admin', { status: 'done', adminNote: '已修正' });

    const mine = (await api('GET', '/feedback/mine', 'token-alice')).body.feedback;
    expect(mine.map((f: any) => f.message)).toEqual(['second', 'first']);
    expect(mine[1]).toMatchObject({ status: 'done', adminNote: '已修正' });
  });
});

describe('admin', () => {
  it('reports who is an admin', async () => {
    expect((await api('GET', '/me', 'token-admin')).body).toEqual({ isAdmin: true });
    expect((await api('GET', '/me', 'token-alice')).body).toEqual({ isAdmin: false });
  });

  it('forbids non-admins', async () => {
    const { id } = (await send('token-alice', { category: 'bug', message: 'x' })).body;
    expect((await api('GET', '/admin/feedback', 'token-alice')).status).toBe(403);
    expect((await api('PATCH', `/admin/feedback/${id}`, 'token-alice', { status: 'done' })).status).toBe(403);
  });

  it('lists all feedback filtered by status and updates it', async () => {
    const a = (await send('token-alice', { category: 'bug', message: 'a' })).body;
    await send('token-bob', { category: 'idea', message: 'b' });

    expect((await api('GET', '/admin/feedback', 'token-admin')).body.feedback).toHaveLength(2);
    const updated = await api('PATCH', `/admin/feedback/${a.id}`, 'token-admin', { status: 'in_progress', adminNote: '處理中' });
    expect(updated.body).toMatchObject({ status: 'in_progress', adminNote: '處理中' });

    const fresh = (await api('GET', '/admin/feedback?status=new', 'token-admin')).body.feedback;
    expect(fresh.map((f: any) => f.message)).toEqual(['b']);
    expect((await api('GET', '/admin/feedback?status=bogus', 'token-admin')).status).toBe(400);
    expect((await api('PATCH', `/admin/feedback/${a.id}`, 'token-admin', { status: 'bogus' })).status).toBe(400);
    expect((await api('PATCH', '/admin/feedback/missing', 'token-admin', { status: 'done' })).status).toBe(404);
  });
});

describe('group command', () => {
  it('replies with the feedback link', async () => {
    await callApp(
      env,
      signedWebhook([
        { type: 'message', replyToken: 'rt', source: { type: 'group', groupId: 'C1', userId: 'Ualice' }, message: { type: 'text', text: '回饋' } },
      ]),
    );
    expect(JSON.stringify(fake.replies.at(-1)!.messages)).toContain('view=feedback');
  });
});
