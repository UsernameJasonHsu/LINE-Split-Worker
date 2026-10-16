import { createHmac } from 'node:crypto';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { getPlatformProxy } from 'wrangler';
import type { Env } from '../src/env';
import { http } from '../src/http';
import app from '../src/index';

export const TEST_ENV = {
  LINE_CHANNEL_SECRET: 'test-channel-secret',
  LINE_CHANNEL_ACCESS_TOKEN: 'test-access-token',
  LINE_LOGIN_CHANNEL_ID: '1234567890',
  LIFF_ID: '2000000000-TestLiff',
};

const TABLES = ['payment_profiles', 'audit_logs', 'fx_rates', 'settlements', 'expense_shares', 'expense_payers', 'expenses', 'members', 'ledgers'];

const MIGRATIONS_DIR = join(__dirname, '..', 'migrations');
export const MIGRATIONS = readdirSync(MIGRATIONS_DIR).sort();

/** Applies migration files in order, one transaction per file like `wrangler d1 migrations apply`. */
export async function applyMigrations(db: D1Database, files = MIGRATIONS): Promise<void> {
  for (const file of files) {
    const sql = readFileSync(join(MIGRATIONS_DIR, file), 'utf8')
      .split('\n')
      .filter((line) => !line.trimStart().startsWith('--'))
      .join('\n');
    const statements = sql.split(';').map((s) => s.trim()).filter(Boolean);
    await db.batch(statements.map((s) => db.prepare(s)));
  }
}

export async function createTestEnv({ migrate = true } = {}) {
  const proxy = await getPlatformProxy<Env>({ configPath: 'wrangler.jsonc', persist: false });
  const env: Env = { ...proxy.env, ...TEST_ENV };
  if (migrate) await applyMigrations(env.DB);

  return {
    env,
    dispose: () => proxy.dispose(),
    reset: async () => {
      await env.DB.batch(TABLES.map((t) => env.DB.prepare(`DELETE FROM ${t}`)));
    },
  };
}

/** Invokes the worker and waits for any waitUntil work (webhook handling). */
export async function callApp(env: Env, req: Request): Promise<Response> {
  const pending: Promise<unknown>[] = [];
  const ctx = {
    waitUntil: (p: Promise<unknown>) => void pending.push(p),
    passThroughOnException: () => {},
    props: {},
  } as unknown as ExecutionContext;
  const res = await app.fetch(req, env, ctx);
  await Promise.all(pending);
  return res;
}

export function signedWebhook(events: unknown[], secret = TEST_ENV.LINE_CHANNEL_SECRET): Request {
  const body = JSON.stringify({ destination: 'Ubot', events });
  const signature = createHmac('sha256', secret).update(body).digest('base64');
  return new Request('https://worker.test/webhook', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-line-signature': signature },
    body,
  });
}

export interface FakeUser {
  sub: string;
  name: string;
  picture?: string;
}

/** Replaces outbound HTTP with an in-memory fake of the LINE and FX APIs. */
export function installFakeExternal() {
  const replies: { replyToken: string; messages: any[] }[] = [];
  const idTokens = new Map<string, FakeUser>();
  const fxRates: Record<string, Record<string, number>> = {};
  const calls = { fx: 0 };

  http.fetch = async (input, init) => {
    const url = new URL(input instanceof Request ? input.url : input.toString());

    if (url.href === 'https://api.line.me/oauth2/v2.1/verify') {
      const params = new URLSearchParams(String(init?.body));
      const user = idTokens.get(params.get('id_token') ?? '');
      if (!user || params.get('client_id') !== TEST_ENV.LINE_LOGIN_CHANNEL_ID) {
        return Response.json({ error: 'invalid_request' }, { status: 400 });
      }
      return Response.json({ ...user, exp: Math.floor(Date.now() / 1000) + 3600 });
    }
    if (url.href === 'https://api.line.me/v2/bot/message/reply') {
      replies.push(JSON.parse(String(init?.body)));
      return Response.json({});
    }
    let m = url.pathname.match(/^\/v2\/bot\/group\/([^/]+)\/summary$/);
    if (m) return Response.json({ groupId: m[1], groupName: '日本旅行' });
    m = url.pathname.match(/^\/v2\/bot\/group\/([^/]+)\/member\/([^/]+)$/);
    if (m) return Response.json({ userId: m[2], displayName: `Group ${m[2]}` });

    if (url.hostname === 'open.er-api.com') {
      calls.fx++;
      const rates = fxRates[url.pathname.split('/').pop()!];
      return Response.json(rates ? { result: 'success', rates } : { result: 'error' });
    }
    throw new Error(`Unexpected fetch: ${url.href}`);
  };

  return { replies, idTokens, fxRates, calls };
}

export function apiRequest(method: string, path: string, token?: string, body?: unknown): Request {
  return new Request(`https://worker.test/api${path}`, {
    method,
    headers: {
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}
