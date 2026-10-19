import type { Context } from 'hono';
import type { AppEnv, Env } from './env';
import { LineClient } from './line/client';
import { handleDirectPostback, handleDirectText } from './directChat';
import {
  DM_HELP_TEXT,
  feedbackUrl,
  HELP_TEXT,
  ledgerLinkMessage,
  liffUrl,
  noOpenLedgerMessage,
  summaryMessage,
  welcomeMessage,
} from './line/messages';
import { verifySignature } from './line/signature';
import {
  archiveGroupLedger,
  ensureGroupLedger,
  findLatestLedgerByGroup,
  findMemberByLineUser,
  findOpenLedgerByGroup,
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
  postback?: { data: string };
}

const DEFAULT_LEDGER_NAME = '分帳帳本';

export async function webhookHandler(c: Context<AppEnv>) {
  const body = await c.req.text();
  const valid = await verifySignature(body, c.req.header('x-line-signature'), c.env.LINE_CHANNEL_SECRET);
  if (!valid) return c.text('Invalid signature', 401);

  let events: WebhookEvent[];
  try {
    events = (JSON.parse(body) as { events?: WebhookEvent[] }).events ?? [];
  } catch {
    return c.text('Invalid body', 400);
  }
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
    if (!replyToken) return;
    if (event.type === 'follow') {
      await line.reply(replyToken, [
        { type: 'text', text: `把我邀請進 LINE 群組，就能一起分帳！\n\n${DM_HELP_TEXT}` },
      ]);
    } else if (event.type === 'message' && event.message?.type === 'text' && event.message.text) {
      await handleDirectText(event.message.text, source.userId, replyToken, env, line);
    } else if (event.type === 'postback' && event.postback) {
      await handleDirectPostback(event.postback.data, source.userId, replyToken, env, line);
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
      // Between ledgers (last one closed) the group has no open ledger; commands
      // then refer to the latest one. A ledger is only auto-created for a group
      // that has never had one (bot added before this service existed).
      const ledger =
        (await findOpenLedgerByGroup(env.DB, source.groupId)) ??
        (await findLatestLedgerByGroup(env.DB, source.groupId)) ??
        (await groupLedger());
      if (source.userId && ledger.closed_at === null) {
        await registerSpeaker(env, line, ledger, source.groupId, source.userId);
      }
      if (event.message?.type === 'text' && event.message.text && replyToken) {
        await handleCommand(event.message.text.trim(), replyToken, env, line, ledger);
      }
      return;
    }
  }
}

/**
 * Adds group members to the ledger the first time they speak. Best effort: a
 * failed profile lookup must not stop the bot from answering the command.
 */
async function registerSpeaker(env: Env, line: LineClient, ledger: LedgerRow, groupId: string, userId: string) {
  try {
    if (await findMemberByLineUser(env.DB, ledger.id, userId)) return;
    const profile = await line.getGroupMemberProfile(groupId, userId);
    await upsertLineMember(env.DB, ledger.id, userId, profile);
  } catch (err) {
    console.error('Failed to register speaker', err);
  }
}

async function handleCommand(text: string, replyToken: string, env: Env, line: LineClient, ledger: LedgerRow) {
  const url = liffUrl(env.LIFF_ID, ledger.id);
  switch (text) {
    case '帳本':
    case '記帳':
      await line.reply(replyToken, [
        ledger.closed_at === null ? ledgerLinkMessage(ledger.name, url) : noOpenLedgerMessage(ledger.name, url),
      ]);
      return;
    case '結算': {
      const members = await listMembers(env.DB, ledger.id);
      const names = new Map(members.map((m) => [m.id, m.display_name]));
      const summary = await getSummary(env.DB, ledger, members);
      await line.reply(replyToken, [
        summaryMessage(
          {
            ledgerName: ledger.name,
            closed: ledger.closed_at !== null,
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
    case '回饋':
    case '意見回饋':
      await line.reply(replyToken, [
        { type: 'text', text: `有問題或建議嗎？歡迎在這裡告訴我們 🙏\n${feedbackUrl(env.LIFF_ID, ledger.id)}` },
      ]);
      return;
    case '說明':
    case 'help':
      await line.reply(replyToken, [{ type: 'text', text: HELP_TEXT }]);
      return;
  }
}
