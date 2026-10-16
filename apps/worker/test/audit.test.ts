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
  fake.idTokens.set('token-eve', { sub: 'Ueve', name: 'Eve' });
});

async function api(method: string, path: string, token?: string, body?: unknown) {
  const res = await callApp(env, apiRequest(method, path, token, body));
  const text = await res.text();
  return { status: res.status, body: text ? JSON.parse(text) : null };
}

async function setup() {
  await callApp(env, signedWebhook([{ type: 'join', replyToken: 'rt', source: { type: 'group', groupId: 'C1' } }]));
  const ledgerId = (await env.DB.prepare('SELECT id FROM ledgers').first<{ id: string }>())!.id;
  const alice = (await api('POST', `/ledgers/${ledgerId}/join`, 'token-alice')).body.meMemberId as string;
  const bob = (await api('POST', `/ledgers/${ledgerId}/join`, 'token-bob')).body.meMemberId as string;
  return { ledgerId, alice, bob };
}

describe('expense notes', () => {
  it('stores, updates and clears a note', async () => {
    const { ledgerId, alice } = await setup();
    const body = {
      title: '晚餐',
      currency: 'TWD',
      amount: '1000',
      note: '  含一成服務費  ',
      payers: [{ memberId: alice, amount: '1000' }],
      split: { type: 'equal', memberIds: [alice] },
    };
    const created = (await api('POST', `/ledgers/${ledgerId}/expenses`, 'token-alice', body)).body;
    expect(created.note).toBe('含一成服務費');

    const cleared = await api('PUT', `/ledgers/${ledgerId}/expenses/${created.id}`, 'token-alice', {
      ...body,
      note: '',
      revision: created.revision,
    });
    expect(cleared.body.note).toBeNull();
    expect((await api('POST', `/ledgers/${ledgerId}/expenses`, 'token-alice', { ...body, note: 'x'.repeat(501) })).status).toBe(400);
  });
});

describe('GET /ledgers/:id/audit', () => {
  it('lists changes newest first with computed snapshots', async () => {
    const { ledgerId, alice, bob } = await setup();
    const body = {
      title: '拉麵',
      currency: 'TWD',
      amount: '600',
      category: 'food',
      payers: [{ memberId: alice, amount: '600' }],
      split: { type: 'equal', memberIds: [alice, bob] },
    };
    const created = (await api('POST', `/ledgers/${ledgerId}/expenses`, 'token-alice', body)).body;
    await api('PUT', `/ledgers/${ledgerId}/expenses/${created.id}`, 'token-bob', {
      ...body,
      amount: '900',
      payers: [{ memberId: alice, amount: '900' }],
      note: '加點煎餃',
      revision: created.revision,
    });
    const settlement = (
      await api('POST', `/ledgers/${ledgerId}/settlements`, 'token-bob', { fromMemberId: bob, toMemberId: alice, amount: '450' })
    ).body;
    await api('DELETE', `/ledgers/${ledgerId}/settlements/${settlement.id}`, 'token-alice');
    await api('DELETE', `/ledgers/${ledgerId}/expenses/${created.id}`, 'token-alice');

    const { status, body: res } = await api('GET', `/ledgers/${ledgerId}/audit`, 'token-bob');
    expect(status).toBe(200);
    expect(res.entries.map((e: any) => [e.entity, e.action, e.actorMemberId])).toEqual([
      ['expense', 'delete', alice],
      ['settlement', 'delete', alice],
      ['settlement', 'create', bob],
      ['expense', 'update', bob],
      ['expense', 'create', alice],
    ]);

    const [deleted, unsettled, settled, updated, createdEntry] = res.entries;
    expect(createdEntry.after).toMatchObject({
      title: '拉麵',
      currency: 'TWD',
      amountMinor: 600,
      category: 'food',
      note: null,
      splitType: 'equal',
      payers: [{ memberId: alice, amountMinor: 600 }],
      shares: [
        { memberId: alice, shareMinor: 300 },
        { memberId: bob, shareMinor: 300 },
      ],
    });
    expect(updated.before).toMatchObject({ amountMinor: 600 });
    expect(updated.after).toMatchObject({
      amountMinor: 900,
      note: '加點煎餃',
      shares: [
        { memberId: alice, shareMinor: 450 },
        { memberId: bob, shareMinor: 450 },
      ],
    });
    expect(settled.after).toMatchObject({ fromMemberId: bob, toMemberId: alice, amountMinor: 450 });
    expect(unsettled.before).toMatchObject({ fromMemberId: bob, toMemberId: alice, amountMinor: 450 });
    expect(deleted.before).toMatchObject({ title: '拉麵', amountMinor: 900 });
    expect(res.baseCurrency).toBe('TWD');
  });

  it('normalises legacy entries that stored the raw request body', async () => {
    const { ledgerId, alice } = await setup();
    await env.DB.prepare(
      `INSERT INTO audit_logs (ledger_id, actor_member_id, action, entity, entity_id, before_json, after_json, at)
       VALUES (?, ?, 'create', 'expense', 'e-old', NULL, ?, 1)`,
    )
      .bind(
        ledgerId,
        alice,
        JSON.stringify({
          title: '舊紀錄',
          currency: 'USD',
          amount: '12.5',
          payers: [{ memberId: alice, amount: '12.5' }],
          split: { type: 'equal', memberIds: [alice] },
        }),
      )
      .run();
    const entry = (await api('GET', `/ledgers/${ledgerId}/audit`, 'token-alice')).body.entries[0];
    expect(entry.after).toMatchObject({
      title: '舊紀錄',
      currency: 'USD',
      amountMinor: 1250,
      payers: [{ memberId: alice, amountMinor: 1250 }],
      shares: null,
    });
  });

  it('is only visible to members', async () => {
    const { ledgerId } = await setup();
    expect((await api('GET', `/ledgers/${ledgerId}/audit`, 'token-eve')).status).toBe(403);
  });
});
