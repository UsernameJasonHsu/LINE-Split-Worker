import type { Context } from 'hono';
import type { AppEnv, Env } from './env';
import { LineClient } from './line/client';
import {
  HELP_TEXT,
  ledgerLinkMessage,
  liffUrl,
  summaryMessage,
  welcomeMessage,
} from './line/messages';
import { verifySignature } from './line/signature';
import {
  archiveGroupLedger,
  ensureGroupLedger,
  findMemberByLineUser,
  listMembers,
  upsertLineMember,
  type LedgerRow,
} from './services/ledgers';
import { getSummary } from './services/settlements';

type Source =
  | { type: 'user'; userId: string }
  | { type: 'group'; groupId: string; userId?: string }
  | { type: 'room'; roomId: string; userId?: string };

interface WebhookEvent {
  type: string;
  replyToken?: string;
  source?: Source;
  message?: { type: string; text?: string };
}

const DEFAULT_LEDGER_NAME = '分帳帳本';

export async function webhookHandler(c: Context<AppEnv>) {
  const body = await c.req.text();
  const valid = await verifySignature(body, c.req.header('x-line-signature'), c.env.LINE_CHANNEL_SECRET);
  if (!valid) return c.text('Invalid signature', 401);

  const { events = [] } = JSON.parse(body) as { events?: WebhookEvent[] };
  // Acknowledge immediately; LINE retries/time-outs are keyed on response latency.
  c.executionCtx.waitUntil(handleEvents(events, c.env));
  return c.text('OK');
}

export async function handleEvents(events: WebhookEvent[], env: Env): Promise<void> {
  const line = new LineClient(env.LINE_CHANNEL_ACCESS_TOKEN);
  for (const event of events) {
    try {
      await handleEvent(event, env, line);
    } catch (err) {
      console.error('Failed to handle webhook event', event.type, err);
    }
  }
}

async function handleEvent(event: WebhookEvent, env: Env, line: LineClient): Promise<void> {
  const { source, replyToken } = event;
  if (!source) return;

  if (source.type === 'user') {
    if ((event.type === 'follow' || event.type === 'message') && replyToken) {
      await line.reply(replyToken, [{ type: 'text', text: `把我邀請進 LINE 群組，就能一起分帳！\n\n${HELP_TEXT}` }]);
    }
    return;
  }

  if (source.type === 'room') {
    if (event.type === 'join' && replyToken) {
      await line.reply(replyToken, [{ type: 'text', text: '目前只支援「群組」，請建立群組後再邀請我。' }]);
    }
    return;
  }

  const groupLedger = () =>
    ensureGroupLedger(env.DB, source.groupId, () =>
      line.getGroupName(source.groupId).catch(() => DEFAULT_LEDGER_NAME),
    );

  switch (event.type) {
    case 'join': {
      const ledger = await groupLedger();
      if (replyToken) await line.reply(replyToken, [welcomeMessage(ledger.name, liffUrl(env.LIFF_ID, ledger.id))]);
      return;
    }
    case 'leave':
      await archiveGroupLedger(env.DB, source.groupId);
      return;
    case 'message': {
      const ledger = await groupLedger();
      if (source.userId) await registerSpeaker(env, line, ledger, source.groupId, source.userId);
      if (event.message?.type === 'text' && event.message.text && replyToken) {
        await handleCommand(event.message.text.trim(), replyToken, env, line, ledger);
      }
      return;
    }
  }
}

/** Adds group members to the ledger the first time they speak. */
async function registerSpeaker(env: Env, line: LineClient, ledger: LedgerRow, groupId: string, userId: string) {
  if (await findMemberByLineUser(env.DB, ledger.id, userId)) return;
  const profile = await line.getGroupMemberProfile(groupId, userId);
  await upsertLineMember(env.DB, ledger.id, userId, profile);
}

async function handleCommand(text: string, replyToken: string, env: Env, line: LineClient, ledger: LedgerRow) {
  const url = liffUrl(env.LIFF_ID, ledger.id);
  switch (text) {
    case '帳本':
    case '記帳':
      await line.reply(replyToken, [ledgerLinkMessage(ledger.name, url)]);
      return;
    case '結算': {
      const members = await listMembers(env.DB, ledger.id);
      const names = new Map(members.map((m) => [m.id, m.display_name]));
      const summary = await getSummary(env.DB, ledger, members);
      await line.reply(replyToken, [
        summaryMessage(
          {
            ledgerName: ledger.name,
            baseCurrency: summary.baseCurrency,
            totalSpentMinor: summary.totalSpentMinor,
            transfers: summary.transfers,
            nameOf: (id) => names.get(id) ?? '?',
          },
          url,
        ),
      ]);
      return;
    }
    case '說明':
    case 'help':
      await line.reply(replyToken, [{ type: 'text', text: HELP_TEXT }]);
      return;
  }
}
