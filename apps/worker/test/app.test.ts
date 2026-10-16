import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { Env } from '../src/env';
import { apiRequest, callApp, createTestEnv, installFakeExternal, signedWebhook, TEST_ENV } from './helpers';

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
  fake.idTokens.set('token-alice', { sub: 'Ualice', name: 'Alice', picture: 'https://example.com/a.png' });
  fake.idTokens.set('token-bob', { sub: 'Ubob', name: 'Bob' });
  fake.idTokens.set('token-eve', { sub: 'Ueve', name: 'Eve' });
});

const groupSource = (userId?: string) => ({ type: 'group', groupId: 'Cgroup1', ...(userId ? { userId } : {}) });

async function joinGroup(): Promise<string> {
  await callApp(env, signedWebhook([{ type: 'join', replyToken: 'rt-join', source: groupSource() }]));
  const row = await env.DB.prepare('SELECT id FROM ledgers WHERE line_group_id = ?').bind('Cgroup1').first<{ id: string }>();
  return row!.id;
}

async function api(method: string, path: string, token?: string, body?: unknown) {
  const res = await callApp(env, apiRequest(method, path, token, body));
  const text = await res.text();
  return { status: res.status, body: text ? JSON.parse(text) : null };
}

describe('webhook', () => {
  it('rejects bad signatures', async () => {
    const res = await callApp(env, signedWebhook([], 'wrong-secret'));
    expect(res.status).toBe(401);
  });

  it('accepts the console verification request (no events)', async () => {
    const res = await callApp(env, signedWebhook([]));
    expect(res.status).toBe(200);
  });

  it('creates a ledger named after the group on join and replies with the LIFF link', async () => {
    const ledgerId = await joinGroup();
    const ledger = await env.DB.prepare('SELECT * FROM ledgers WHERE id = ?').bind(ledgerId).first<{ name: string }>();
    expect(ledger!.name).toBe('日本旅行');

    expect(fake.replies).toHaveLength(1);
    expect(fake.replies[0]!.replyToken).toBe('rt-join');
    expect(JSON.stringify(fake.replies[0]!.messages)).toContain(
      `https://liff.line.me/${TEST_ENV.LIFF_ID}?l=${ledgerId}`,
    );
  });

  it('reuses the same ledger when re-joined and un-archives it after leave', async () => {
    const first = await joinGroup();
    await callApp(env, signedWebhook([{ type: 'leave', source: groupSource() }]));
    const archived = await env.DB.prepare('SELECT archived_at FROM ledgers WHERE id = ?').bind(first).first<{ archived_at: number | null }>();
    expect(archived!.archived_at).not.toBeNull();

    const second = await joinGroup();
    expect(second).toBe(first);
    const restored = await env.DB.prepare('SELECT archived_at FROM ledgers WHERE id = ?').bind(first).first<{ archived_at: number | null }>();
    expect(restored!.archived_at).toBeNull();
  });

  it('registers speakers and answers the 結算 command', async () => {
    const ledgerId = await joinGroup();
    await callApp(
      env,
      signedWebhook([
        { type: 'message', replyToken: 'rt-1', source: groupSource('Ualice'), message: { type: 'text', text: '大家好' } },
        { type: 'message', replyToken: 'rt-2', source: groupSource('Ubob'), message: { type: 'text', text: ' 結算 ' } },
      ]),
    );

    const { results } = await env.DB.prepare('SELECT display_name FROM members WHERE ledger_id = ? ORDER BY display_name')
      .bind(ledgerId)
      .all<{ display_name: string }>();
    expect(results.map((r) => r.display_name)).toEqual(['Group Ualice', 'Group Ubob']);

    // Only the command gets a reply (plus the join welcome).
    expect(fake.replies.map((r) => r.replyToken)).toEqual(['rt-join', 'rt-2']);
    expect(fake.replies[1]!.messages[0].altText).toContain('結算');
  });

  it('creates the ledger lazily when the bot predates the deployment', async () => {
    await callApp(
      env,
      signedWebhook([{ type: 'message', replyToken: 'rt', source: groupSource('Ualice'), message: { type: 'text', text: '帳本' } }]),
    );
    expect(fake.replies).toHaveLength(1);
    expect(JSON.stringify(fake.replies[0]!.messages)).toContain('https://liff.line.me/');
  });
});

describe('api auth', () => {
  it('requires a valid ID token', async () => {
    const ledgerId = await joinGroup();
    expect((await api('GET', `/ledgers/${ledgerId}`)).status).toBe(401);
    expect((await api('GET', `/ledgers/${ledgerId}`, 'forged-token')).status).toBe(401);
  });

  it('returns 404 for unknown ledgers and 403 for non-members', async () => {
    const ledgerId = await joinGroup();
    expect((await api('POST', '/ledgers/nope/join', 'token-alice')).status).toBe(404);
    expect((await api('GET', `/ledgers/${ledgerId}`, 'token-eve')).status).toBe(403);
    expect((await api('GET', `/ledgers/${ledgerId}/summary`, 'token-eve')).status).toBe(403);
  });

  it('join is idempotent and merges with the member registered from the group', async () => {
    const ledgerId = await joinGroup();
    await callApp(
      env,
      signedWebhook([{ type: 'message', replyToken: 'rt', source: groupSource('Ualice'), message: { type: 'text', text: 'hi' } }]),
    );
    const first = await api('POST', `/ledgers/${ledgerId}/join`, 'token-alice');
    const second = await api('POST', `/ledgers/${ledgerId}/join`, 'token-alice');
    expect(first.status).toBe(200);
    expect(second.body.members).toHaveLength(1);
    expect(second.body.members[0]).toMatchObject({ displayName: 'Alice', avatarUrl: 'https://example.com/a.png' });
    expect(second.body.meMemberId).toBe(first.body.meMemberId);
  });
});

describe('expenses and settlement flow', () => {
  async function setupLedger() {
    const ledgerId = await joinGroup();
    const alice = (await api('POST', `/ledgers/${ledgerId}/join`, 'token-alice')).body.meMemberId as string;
    const bob = (await api('POST', `/ledgers/${ledgerId}/join`, 'token-bob')).body.meMemberId as string;
    return { ledgerId, alice, bob };
  }

  it('records a JPY expense with a manual rate and suggests the transfer', async () => {
    const { ledgerId, alice, bob } = await setupLedger();
    const created = await api('POST', `/ledgers/${ledgerId}/expenses`, 'token-alice', {
      title: '拉麵',
      currency: 'JPY',
      amount: '3000',
      fxRate: '0.2153',
      payers: [{ memberId: alice, amount: '3000' }],
      split: { type: 'equal', memberIds: [alice, bob] },
    });
    expect(created.status).toBe(201);
    // ¥3000 × 0.2153 = 645.9 → 646, split 323 / 323
    expect(created.body).toMatchObject({ fxSource: 'MANUAL', baseAmountMinor: 646 });
    expect(created.body.shares.map((s: any) => s.baseShareMinor)).toEqual([323, 323]);

    const summary = await api('GET', `/ledgers/${ledgerId}/summary`, 'token-bob');
    expect(summary.body.totalSpentMinor).toBe(646);
    expect(summary.body.transfers).toEqual([{ from: bob, to: alice, amountMinor: 323 }]);

    const settled = await api('POST', `/ledgers/${ledgerId}/settlements`, 'token-bob', {
      fromMemberId: bob,
      toMemberId: alice,
      amount: '323',
    });
    expect(settled.status).toBe(201);
    expect((await api('GET', `/ledgers/${ledgerId}/summary`, 'token-bob')).body.transfers).toEqual([]);

    // Undoing the settlement restores the debt.
    expect((await api('DELETE', `/ledgers/${ledgerId}/settlements/${settled.body.id}`, 'token-bob')).status).toBe(204);
    expect((await api('GET', `/ledgers/${ledgerId}/summary`, 'token-bob')).body.transfers).toHaveLength(1);
  });

  it('fetches and caches the auto rate when none is given', async () => {
    const { ledgerId, alice, bob } = await setupLedger();
    fake.fxRates.USD = { TWD: 32.5, JPY: 150, EUR: 0.92 };
    const body = {
      title: 'Taxi',
      currency: 'USD',
      amount: '10.01',
      payers: [{ memberId: alice, amount: '10.01' }],
      split: { type: 'equal', memberIds: [alice, bob] },
    };
    const first = await api('POST', `/ledgers/${ledgerId}/expenses`, 'token-alice', body);
    expect(first.body).toMatchObject({ fxSource: 'AUTO', fxRate: '32.5', baseAmountMinor: 325 });
    await api('POST', `/ledgers/${ledgerId}/expenses`, 'token-alice', body);
    expect(fake.calls.fx).toBe(1);

    const quote = await api('GET', '/fx?from=USD&to=JPY', 'token-alice');
    expect(quote.body.rate).toBe('150');
    expect(fake.calls.fx).toBe(1);
  });

  it('updates with optimistic concurrency', async () => {
    const { ledgerId, alice, bob } = await setupLedger();
    const body = {
      title: '晚餐',
      currency: 'TWD',
      amount: '900',
      payers: [{ memberId: alice, amount: '900' }],
      split: { type: 'equal', memberIds: [alice, bob] },
    };
    const created = (await api('POST', `/ledgers/${ledgerId}/expenses`, 'token-alice', body)).body;

    const updated = await api('PUT', `/ledgers/${ledgerId}/expenses/${created.id}`, 'token-bob', {
      ...body,
      amount: '1000',
      payers: [{ memberId: alice, amount: '1000' }],
      split: { type: 'weights', items: [{ memberId: alice, weight: 3 }, { memberId: bob, weight: 2 }] },
      revision: created.revision,
    });
    expect(updated.status).toBe(200);
    expect(updated.body.shares.map((s: any) => [s.splitValue, s.shareMinor])).toEqual([
      [3, 600],
      [2, 400],
    ]);
    expect(updated.body.revision).not.toBe(created.revision);

    // A second edit based on the stale revision must not clobber the first.
    const stale = await api('PUT', `/ledgers/${ledgerId}/expenses/${created.id}`, 'token-alice', {
      ...body,
      revision: created.revision,
    });
    expect(stale.status).toBe(409);
    const list = (await api('GET', `/ledgers/${ledgerId}/expenses`, 'token-alice')).body.expenses;
    expect(list).toHaveLength(1);
    expect(list[0].amountMinor).toBe(1000);
    // The rejected edit (equal split) must not have replaced the weighted shares.
    expect(list[0].splitType).toBe('weights');
    expect(list[0].shares.map((s: any) => [s.splitValue, s.shareMinor])).toEqual([
      [3, 600],
      [2, 400],
    ]);
  });

  it('keeps the original rate when an edit omits fxRate and keeps the currency', async () => {
    const { ledgerId, alice, bob } = await setupLedger();
    fake.fxRates.USD = { TWD: 32.5 };
    const body = {
      title: 'Taxi',
      currency: 'USD',
      amount: '10',
      payers: [{ memberId: alice, amount: '10' }],
      split: { type: 'equal', memberIds: [alice, bob] },
    };
    const created = (await api('POST', `/ledgers/${ledgerId}/expenses`, 'token-alice', body)).body;

    // Rates move (new day / cache cleared); editing the title must not re-price it.
    await env.DB.prepare('DELETE FROM fx_rates').run();
    fake.fxRates.USD = { TWD: 40 };
    const edited = await api('PUT', `/ledgers/${ledgerId}/expenses/${created.id}`, 'token-alice', {
      ...body,
      title: 'Taxi to hotel',
      revision: created.revision,
    });
    expect(edited.body).toMatchObject({ fxRate: '32.5', fxSource: 'AUTO', baseAmountMinor: 325 });

    // Changing the currency does fetch a fresh rate.
    fake.fxRates.EUR = { TWD: 35 };
    const switched = await api('PUT', `/ledgers/${ledgerId}/expenses/${created.id}`, 'token-alice', {
      ...body,
      currency: 'EUR',
      revision: edited.body.revision,
    });
    expect(switched.body).toMatchObject({ fxRate: '35', fxSource: 'AUTO', baseAmountMinor: 350 });
  });

  it('soft-deletes expenses and writes audit logs', async () => {
    const { ledgerId, alice } = await setupLedger();
    const created = (
      await api('POST', `/ledgers/${ledgerId}/expenses`, 'token-alice', {
        title: '咖啡',
        currency: 'TWD',
        amount: '120',
        payers: [{ memberId: alice, amount: '120' }],
        split: { type: 'equal', memberIds: [alice] },
      })
    ).body;
    expect((await api('DELETE', `/ledgers/${ledgerId}/expenses/${created.id}`, 'token-alice')).status).toBe(204);
    expect((await api('DELETE', `/ledgers/${ledgerId}/expenses/${created.id}`, 'token-alice')).status).toBe(404);
    expect((await api('GET', `/ledgers/${ledgerId}/expenses`, 'token-alice')).body.expenses).toEqual([]);

    const { results } = await env.DB.prepare('SELECT action FROM audit_logs WHERE entity_id = ? ORDER BY id')
      .bind(created.id)
      .all<{ action: string }>();
    expect(results.map((r) => r.action)).toEqual(['create', 'delete']);
  });

  it('validates input', async () => {
    const { ledgerId, alice, bob } = await setupLedger();
    const base = {
      title: 'x',
      currency: 'TWD',
      amount: '100',
      payers: [{ memberId: alice, amount: '100' }],
      split: { type: 'equal', memberIds: [alice, bob] },
    };
    const post = (body: unknown) => api('POST', `/ledgers/${ledgerId}/expenses`, 'token-alice', body);

    expect((await post({ ...base, split: { type: 'equal', memberIds: ['ghost'] } })).body.error).toMatch(/unknown member/i);
    expect((await post({ ...base, payers: [{ memberId: alice, amount: '99' }] })).status).toBe(400);
    expect((await post({ ...base, amount: '100.5' })).status).toBe(400);
    expect((await post({ ...base, currency: 'XYZ' })).status).toBe(400);
    expect((await post({ ...base, title: '' })).status).toBe(400);
    expect(
      (await api('POST', `/ledgers/${ledgerId}/settlements`, 'token-alice', { fromMemberId: alice, toMemberId: alice, amount: '1' })).status,
    ).toBe(400);
  });

  describe('closing a ledger and starting the next one', () => {
    async function closeWithActivity() {
      const { ledgerId, alice, bob } = await setupLedger();
      await api('POST', `/ledgers/${ledgerId}/expenses`, 'token-alice', {
        title: '拉麵',
        currency: 'TWD',
        amount: '600',
        payers: [{ memberId: alice, amount: '600' }],
        split: { type: 'equal', memberIds: [alice, bob] },
      });
      const closed = await api('POST', `/ledgers/${ledgerId}/close`, 'token-bob');
      return { ledgerId, alice, bob, closed };
    }

    const sendText = (text: string) =>
      callApp(
        env,
        signedWebhook([{ type: 'message', replyToken: 'rt', source: groupSource('Ualice'), message: { type: 'text', text } }]),
      );

    it('closing leaves the group without an open ledger', async () => {
      const { ledgerId, closed } = await closeWithActivity();
      expect(closed.status).toBe(200);
      expect(closed.body.ledger).toMatchObject({ id: ledgerId, closedAt: expect.any(Number), activeLedgerId: null });
      // History, including the unsettled balance, stays readable.
      expect((await api('GET', `/ledgers/${ledgerId}/summary`, 'token-alice')).body.transfers).toHaveLength(1);
    });

    it('starts the next ledger later, carrying over members', async () => {
      const { ledgerId } = await closeWithActivity();
      const next = await api('POST', `/ledgers/${ledgerId}/next`, 'token-bob', { name: '韓國行' });
      expect(next.status).toBe(201);
      expect(next.body.ledger).toMatchObject({ name: '韓國行', baseCurrency: 'TWD', closedAt: null });
      expect(next.body.ledger.activeLedgerId).toBe(next.body.ledger.id);
      expect(next.body.members.map((m: any) => m.displayName)).toEqual(['Alice', 'Bob']);
      expect(next.body.members.find((m: any) => m.id === next.body.meMemberId).displayName).toBe('Bob');
      expect((await api('GET', `/ledgers/${next.body.ledger.id}/summary`, 'token-alice')).body).toMatchObject({
        totalSpentMinor: 0,
        transfers: [],
      });
      expect((await api('GET', `/ledgers/${ledgerId}`, 'token-alice')).body.ledger.activeLedgerId).toBe(next.body.ledger.id);
    });

    it('allows only one open ledger per group', async () => {
      const { ledgerId } = await closeWithActivity();
      const [a, b] = await Promise.all([
        api('POST', `/ledgers/${ledgerId}/next`, 'token-alice', { name: 'A' }),
        api('POST', `/ledgers/${ledgerId}/next`, 'token-bob', { name: 'B' }),
      ]);
      expect([a.status, b.status].sort()).toEqual([201, 409]);
      const open = await env.DB.prepare('SELECT COUNT(*) AS n FROM ledgers WHERE closed_at IS NULL').first<{ n: number }>();
      expect(open!.n).toBe(1);
      // An open ledger also blocks starting another from it.
      const opened = (a.status === 201 ? a : b).body.ledger.id;
      expect((await api('POST', `/ledgers/${opened}/next`, 'token-alice', { name: 'C' })).status).toBe(409);
    });

    it('lists the group ledgers newest first with membership', async () => {
      const { ledgerId } = await closeWithActivity();
      const next = (await api('POST', `/ledgers/${ledgerId}/next`, 'token-alice', { name: '韓國行' })).body;
      const history = await api('GET', `/ledgers/${next.ledger.id}/history`, 'token-alice');
      expect(history.body.ledgers).toEqual([
        expect.objectContaining({ id: next.ledger.id, name: '韓國行', closedAt: null, totalSpentMinor: 0, isMember: true }),
        expect.objectContaining({ id: ledgerId, name: '日本旅行', totalSpentMinor: 600, isMember: true }),
      ]);
    });

    it('makes the closed ledger read-only', async () => {
      const { ledgerId, alice, bob } = await closeWithActivity();
      const expenseId = (await api('GET', `/ledgers/${ledgerId}/expenses`, 'token-alice')).body.expenses[0].id;
      const writes = [
        api('POST', `/ledgers/${ledgerId}/expenses`, 'token-alice', {
          title: 'x',
          currency: 'TWD',
          amount: '1',
          payers: [{ memberId: alice, amount: '1' }],
          split: { type: 'equal', memberIds: [alice] },
        }),
        api('DELETE', `/ledgers/${ledgerId}/expenses/${expenseId}`, 'token-alice'),
        api('POST', `/ledgers/${ledgerId}/settlements`, 'token-bob', { fromMemberId: bob, toMemberId: alice, amount: '300' }),
        api('PATCH', `/ledgers/${ledgerId}`, 'token-alice', { name: 'renamed' }),
        api('POST', `/ledgers/${ledgerId}/close`, 'token-alice'),
      ];
      for (const res of await Promise.all(writes)) expect(res.status).toBe(409);
    });

    it('only lets existing members open a closed ledger', async () => {
      const { ledgerId } = await closeWithActivity();
      expect((await api('POST', `/ledgers/${ledgerId}/join`, 'token-eve')).status).toBe(403);
      expect((await api('POST', `/ledgers/${ledgerId}/join`, 'token-alice')).status).toBe(200);
    });

    it('group commands explain there is no open ledger, then follow the new one', async () => {
      const { ledgerId } = await closeWithActivity();
      fake.replies.length = 0;

      await sendText('帳本');
      const noLedger = JSON.stringify(fake.replies[0]!.messages);
      expect(noLedger).toContain('沒有進行中的帳本');
      expect(noLedger).toContain(`?l=${ledgerId}`); // opens the last ledger, where a new one can be started

      await sendText('結算');
      expect(fake.replies[1]!.messages[0].altText).toContain('已結束');

      // No ledger is created implicitly while the group is between ledgers.
      const count = await env.DB.prepare('SELECT COUNT(*) AS n FROM ledgers').first<{ n: number }>();
      expect(count!.n).toBe(1);

      const next = (await api('POST', `/ledgers/${ledgerId}/next`, 'token-alice', { name: '韓國行' })).body;
      await sendText('帳本');
      expect(JSON.stringify(fake.replies[2]!.messages)).toContain(`?l=${next.ledger.id}`);
    });

    it('carries over only the chosen members, always including the starter', async () => {
      const { ledgerId, alice } = await closeWithActivity();
      await api('POST', `/ledgers/${ledgerId}/join`, 'token-alice'); // ensure alice is listed
      // Bob starts the next ledger choosing only Alice; Bob is added anyway.
      const next = await api('POST', `/ledgers/${ledgerId}/next`, 'token-bob', { name: '韓國行', memberIds: [alice] });
      expect(next.status).toBe(201);
      expect(next.body.members.map((m: any) => m.displayName).sort()).toEqual(['Alice', 'Bob']);

      const { ledgerId: other } = await (async () => {
        // A fresh closed ledger where Carol was a member but is not chosen.
        const l = (await api('POST', `/ledgers/${next.body.ledger.id}/join`, 'token-eve')).body;
        await api('POST', `/ledgers/${l.ledger.id}/close`, 'token-eve');
        return { ledgerId: l.ledger.id };
      })();
      const onlyMe = await api('POST', `/ledgers/${other}/next`, 'token-alice', { name: '泰國', memberIds: [] });
      expect(onlyMe.body.members.map((m: any) => m.displayName)).toEqual(['Alice']);
    });

    it('rejects member ids that are not in the previous ledger', async () => {
      const { ledgerId } = await closeWithActivity();
      const res = await api('POST', `/ledgers/${ledgerId}/next`, 'token-alice', { name: 'x', memberIds: ['ghost'] });
      expect(res.status).toBe(400);
      expect((await env.DB.prepare('SELECT COUNT(*) AS n FROM ledgers').first<{ n: number }>())!.n).toBe(1);
    });

    it('rejects a blank name and renames an open ledger', async () => {
      const { ledgerId } = await closeWithActivity();
      expect((await api('POST', `/ledgers/${ledgerId}/next`, 'token-alice', { name: '  ' })).status).toBe(400);
      const next = (await api('POST', `/ledgers/${ledgerId}/next`, 'token-alice', { name: '未命名' })).body;
      const renamed = await api('PATCH', `/ledgers/${next.ledger.id}`, 'token-alice', { name: '韓國行' });
      expect(renamed.body.ledger.name).toBe('韓國行');
    });
  });

  it('settles an expense paid by several people', async () => {
    const { ledgerId, alice, bob } = await setupLedger();
    const carol = (await api('POST', `/ledgers/${ledgerId}/join`, 'token-eve')).body.meMemberId as string;
    const created = await api('POST', `/ledgers/${ledgerId}/expenses`, 'token-alice', {
      title: '飯店',
      currency: 'TWD',
      amount: '9000',
      payers: [
        { memberId: alice, amount: '6000' },
        { memberId: bob, amount: '3000' },
      ],
      split: { type: 'equal', memberIds: [alice, bob, carol] },
    });
    expect(created.status).toBe(201);
    // alice +6000-3000 = +3000, bob 0, carol -3000
    const summary = (await api('GET', `/ledgers/${ledgerId}/summary`, 'token-alice')).body;
    expect(summary.transfers).toEqual([{ from: carol, to: alice, amountMinor: 3000 }]);
  });

  describe('payment info', () => {
    it('is set by the user and shown to fellow members in every ledger', async () => {
      const { ledgerId } = await setupLedger();
      const saved = await api('PUT', '/me/payment-info', 'token-bob', { info: ' 中信 822-123456789 ' });
      expect(saved.body).toEqual({ info: '中信 822-123456789' });

      const members = (await api('GET', `/ledgers/${ledgerId}`, 'token-alice')).body.members;
      expect(members.find((m: any) => m.displayName === 'Bob').paymentInfo).toBe('中信 822-123456789');
      expect(members.find((m: any) => m.displayName === 'Alice').paymentInfo).toBeNull();
      expect((await api('GET', '/me/payment-info', 'token-bob')).body).toEqual({ info: '中信 822-123456789' });
    });

    it('clears when empty and validates length', async () => {
      await api('PUT', '/me/payment-info', 'token-bob', { info: 'x' });
      expect((await api('PUT', '/me/payment-info', 'token-bob', { info: '  ' })).body).toEqual({ info: null });
      expect((await api('GET', '/me/payment-info', 'token-bob')).body).toEqual({ info: null });
      expect((await api('PUT', '/me/payment-info', 'token-bob', { info: 'x'.repeat(201) })).status).toBe(400);
      expect((await api('PUT', '/me/payment-info', undefined, { info: 'x' })).status).toBe(401);
    });
  });

  it('locks the base currency once there is activity', async () => {
    const { ledgerId, alice } = await setupLedger();
    expect((await api('PATCH', `/ledgers/${ledgerId}`, 'token-alice', { baseCurrency: 'JPY', name: '大阪' })).body.ledger).toMatchObject({
      baseCurrency: 'JPY',
      name: '大阪',
    });
    await api('POST', `/ledgers/${ledgerId}/expenses`, 'token-alice', {
      title: '咖啡',
      currency: 'JPY',
      amount: '500',
      payers: [{ memberId: alice, amount: '500' }],
      split: { type: 'equal', memberIds: [alice] },
    });
    expect((await api('PATCH', `/ledgers/${ledgerId}`, 'token-alice', { baseCurrency: 'TWD' })).status).toBe(409);
  });
});
