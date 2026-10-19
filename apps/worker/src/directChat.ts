import { formatMinor, formatMoney, guessCategory, toMinor } from '@line-split/core';
import type { Env } from './env';
import { HttpError } from './errors';
import type { LineClient } from './line/client';
import { DM_HELP_TEXT, entryConfirmMessage, liffUrl, type QuickReplyItem } from './line/messages';
import { entryAmount, parseQuickEntry, type QuickEntry } from './quickEntry';
import type { ExpenseBody } from './schemas';
import { createExpense, deleteExpense, getExpense, type ExpenseDto } from './services/expenses';
import { findLedger, findMemberByLineUser, listMembers, type LedgerRow, type MemberRow } from './services/ledgers';

/**
 * Bookkeeping from a private chat with the bot ("午餐 1200"), so the group
 * chat isn't flooded with entries and confirmations. The expense goes to the
 * sender's open ledger they last recorded in, split equally among everyone.
 */

interface MyLedger {
  ledger: LedgerRow;
  /** Latest expense this user created there; null if none yet. */
  lastUsed: number | null;
}

/** Open ledgers the user belongs to, the one they last recorded in first. */
export async function listMyOpenLedgers(db: D1Database, lineUserId: string): Promise<MyLedger[]> {
  const { results } = await db
    .prepare(
      `SELECT l.*, (SELECT MAX(e.created_at) FROM expenses e
                    WHERE e.ledger_id = l.id AND e.created_by = m.id AND e.deleted_at IS NULL) AS last_used
       FROM ledgers l JOIN members m ON m.ledger_id = l.id
       WHERE m.line_user_id = ? AND l.closed_at IS NULL AND l.archived_at IS NULL
       ORDER BY last_used IS NULL, last_used DESC, l.created_at DESC`,
    )
    .bind(lineUserId)
    .all<LedgerRow & { last_used: number | null }>();
  return results.map(({ last_used, ...ledger }) => ({ ledger, lastUsed: last_used }));
}

/** Postback payloads (LINE caps `data` at 300 characters). */
type Action =
  | { k: 'add'; l: string; t: string }
  | { k: 'undo'; l: string; e: string }
  | { k: 'move'; l: string; e: string; to: string };

const POSTBACK_LIMIT = 300;
const QUICK_REPLY_LIMIT = 13;

function postback(label: string, action: Action, displayText: string): QuickReplyItem | null {
  const data = JSON.stringify(action);
  if (data.length > POSTBACK_LIMIT) return null;
  // Quick reply labels are capped at 20 characters.
  return { type: 'action', action: { type: 'postback', label: label.slice(0, 20), data, displayText } };
}

const text = (t: string, quickReply?: QuickReplyItem[]) => ({
  type: 'text',
  text: t,
  ...(quickReply?.length ? { quickReply: { items: quickReply } } : {}),
});

export async function handleDirectText(
  input: string,
  userId: string,
  replyToken: string,
  env: Env,
  line: LineClient,
): Promise<void> {
  const entry = parseQuickEntry(input);
  if (!entry) {
    await line.reply(replyToken, [text(DM_HELP_TEXT)]);
    return;
  }
  const ledgers = await listMyOpenLedgers(env.DB, userId);
  if (ledgers.length === 0) {
    await line.reply(replyToken, [
      text('你還沒有加入進行中的帳本。請先在群組裡點「打開帳本」加入，之後就能在這裡快速記帳。'),
    ]);
    return;
  }
  // Several ledgers and never recorded in any: ask which one.
  if (ledgers.length > 1 && ledgers.every((l) => l.lastUsed === null)) {
    const choices = ledgers
      .slice(0, QUICK_REPLY_LIMIT)
      .map(({ ledger }) => postback(ledger.name, { k: 'add', l: ledger.id, t: input.trim() }, `記到「${ledger.name}」`))
      .filter((c): c is QuickReplyItem => c !== null);
    if (choices.length === ledgers.slice(0, QUICK_REPLY_LIMIT).length) {
      await line.reply(replyToken, [text(`要把「${entry.title}」記到哪一本帳本？`, choices)]);
      return;
    }
  }
  await record(entry, ledgers[0]!.ledger, ledgers, userId, replyToken, env, line);
}

export async function handleDirectPostback(
  data: string,
  userId: string,
  replyToken: string,
  env: Env,
  line: LineClient,
): Promise<void> {
  let action: Action;
  try {
    action = JSON.parse(data) as Action;
  } catch {
    return;
  }
  const scope = await memberScope(env.DB, action.l, userId);
  if (!scope) {
    await line.reply(replyToken, [text('這本帳本已結束，或你已不是成員。')]);
    return;
  }

  if (action.k === 'add') {
    const entry = parseQuickEntry(action.t);
    if (!entry) return;
    await record(entry, scope.ledger, await listMyOpenLedgers(env.DB, userId), userId, replyToken, env, line);
    return;
  }

  const expense = await getExpense(env.DB, scope.ledger.id, action.e);
  const problem = !expense
    ? '這筆已經刪除了。'
    : expense.createdBy !== scope.me.id || expense.updatedAt !== expense.createdAt
      ? '這筆已經在帳本中被修改過，請到帳本裡處理。'
      : null;
  if (problem || !expense) {
    await line.reply(replyToken, [text(problem!)]);
    return;
  }

  if (action.k === 'undo') {
    await deleteExpense(env.DB, scope.ledger, scope.me, expense.id);
    await line.reply(replyToken, [text(`已刪除「${expense.title}」。`)]);
    return;
  }

  if (action.k === 'move') {
    const target = await memberScope(env.DB, action.to, userId);
    if (!target) {
      await line.reply(replyToken, [text('目標帳本已結束，或你已不是成員。')]);
      return;
    }
    // Only everyone-splits entries offer a move, so the target's members split it too.
    const entry: QuickEntry = {
      title: expense.title,
      amount: formatMinor(expense.amountMinor, expense.currency),
      currency: expense.currency,
      participants: null,
    };
    const created = await createEntry(entry, target.ledger, target.members, target.me, env);
    if (typeof created === 'string') {
      await line.reply(replyToken, [text(created)]);
      return;
    }
    await deleteExpense(env.DB, scope.ledger, scope.me, expense.id);
    const ledgers = await listMyOpenLedgers(env.DB, userId);
    await line.reply(replyToken, [confirmation(created, target.ledger, target.members, ledgers, env)]);
  }
}

async function memberScope(db: D1Database, ledgerId: string, lineUserId: string) {
  const ledger = await findLedger(db, ledgerId);
  if (!ledger || ledger.closed_at !== null || ledger.archived_at !== null) return null;
  const me = await findMemberByLineUser(db, ledger.id, lineUserId);
  if (!me) return null;
  return { ledger, me, members: await listMembers(db, ledger.id) };
}

async function record(
  entry: QuickEntry,
  ledger: LedgerRow,
  myLedgers: MyLedger[],
  userId: string,
  replyToken: string,
  env: Env,
  line: LineClient,
): Promise<void> {
  const scope = await memberScope(env.DB, ledger.id, userId);
  if (!scope) {
    await line.reply(replyToken, [text('這本帳本已結束，或你已不是成員。')]);
    return;
  }
  const created = await createEntry(entry, scope.ledger, scope.members, scope.me, env);
  if (typeof created === 'string') {
    await line.reply(replyToken, [text(created)]);
    return;
  }
  await line.reply(replyToken, [confirmation(created, scope.ledger, scope.members, myLedgers, env)]);
}

/** Creates the expense (payer: me), or returns why not. */
async function createEntry(
  entry: QuickEntry,
  ledger: LedgerRow,
  members: MemberRow[],
  me: MemberRow,
  env: Env,
): Promise<ExpenseDto | string> {
  const currency = entry.currency ?? ledger.base_currency;
  const amount = entryAmount(entry.amount, currency);
  if (!amount) return '金額看不懂，請輸入像「午餐 1200」這樣的格式。';
  const split = resolveSplit(entry, amount, currency, members, me);
  if (typeof split === 'string') return split;
  const { results: past } = await env.DB.prepare(
    `SELECT title, category, created_at AS createdAt FROM expenses
     WHERE ledger_id = ? AND deleted_at IS NULL AND category IS NOT NULL ORDER BY created_at DESC LIMIT 200`,
  )
    .bind(ledger.id)
    .all<{ title: string; category: string; createdAt: number }>();
  try {
    return await createExpense(env.DB, ledger, members, me, {
      title: entry.title,
      currency,
      amount,
      category: guessCategory(entry.title, past),
      payers: [{ memberId: me.id, amount }],
      split,
    });
  } catch (err) {
    if (err instanceof HttpError && err.status === 502) return '暫時無法取得匯率，請到帳本中手動輸入匯率記帳。';
    if (err instanceof HttpError && err.status === 400) return `無法記帳：${err.message}`;
    throw err;
  }
}

/**
 * The split for the entry's "@name [amount]" list: none → everyone equally;
 * names only → those equally; some amounts → fixed amounts plus the rest split
 * among the others; all amounts → exactly those (must add up to the total).
 */
function resolveSplit(
  entry: QuickEntry,
  total: string,
  currency: string,
  members: MemberRow[],
  me: MemberRow,
): ExpenseBody['split'] | string {
  if (!entry.participants) return { type: 'equal', memberIds: members.map((m) => m.id) };
  const seen = new Set<string>();
  const fixed: { memberId: string; amount: string }[] = [];
  const rest: string[] = [];
  for (const p of entry.participants) {
    const member = matchMember(p.name, members, me);
    if (typeof member === 'string') return member;
    if (seen.has(member.id)) return `「${member.display_name}」重複出現了。`;
    seen.add(member.id);
    if (p.amount === null) {
      rest.push(member.id);
      continue;
    }
    const amount = entryAmount(p.amount, currency);
    if (!amount) return `「${p.name}」的金額看不懂。`;
    fixed.push({ memberId: member.id, amount });
  }
  if (fixed.length === 0) return { type: 'equal', memberIds: rest };

  const totalMinor = toMinor(total, currency);
  const fixedMinor = fixed.reduce((sum, f) => sum + toMinor(f.amount, currency), 0);
  const money = (minor: number) => formatMoney(minor, currency);
  if (rest.length === 0) {
    if (fixedMinor !== totalMinor) {
      return `每個人的金額加起來是 ${money(fixedMinor)}，和總額 ${money(totalMinor)} 不同。`;
    }
    return { type: 'exact', items: fixed };
  }
  if (fixedMinor > totalMinor) return `指定的金額加起來 ${money(fixedMinor)}，超過總額 ${money(totalMinor)}。`;
  return { type: 'fixed_rest', fixed, restMemberIds: rest };
}

const SELF = new Set(['我', '自己', 'me']);
const normalizeName = (name: string) => name.replace(/\s+/g, '').toLowerCase();

/** The member a typed name refers to: "我" for oneself, else an exact or unique partial match. */
function matchMember(name: string, members: MemberRow[], me: MemberRow): MemberRow | string {
  const key = normalizeName(name);
  if (SELF.has(key)) return me;
  const exact = members.filter((m) => normalizeName(m.display_name) === key);
  if (exact.length === 1) return exact[0]!;
  const partial = exact.length > 1 ? exact : members.filter((m) => normalizeName(m.display_name).includes(key));
  if (partial.length === 1) return partial[0]!;
  if (partial.length > 1) {
    return `「${name}」符合多位成員（${partial.map((m) => m.display_name).join('、')}），請打完整一點。`;
  }
  return `找不到「${name}」。這本帳本的成員有：${members.map((m) => m.display_name).join('、')}（自己可以打「@我」）。`;
}

/** e.g. "4 人均分，每人 TWD 300" / "小明、小華均分，每人 …" / "小明 TWD 500、小華 TWD 700". */
function describeSplit(expense: ExpenseDto, members: MemberRow[], nameOf: (id: string) => string): string {
  const shares = expense.shares.filter((s) => s.shareMinor > 0);
  const each = shares[0]?.shareMinor ?? 0;
  const money = (minor: number) => formatMoney(minor, expense.currency);
  if (shares.every((s) => s.shareMinor === each)) {
    const who = shares.length === members.length ? `${shares.length} 人` : shares.map((s) => nameOf(s.memberId)).join('、');
    return `${who}均分，每人 ${money(each)}`;
  }
  return shares.map((s) => `${nameOf(s.memberId)} ${money(s.shareMinor)}`).join('、');
}

function confirmation(expense: ExpenseDto, ledger: LedgerRow, members: MemberRow[], myLedgers: MyLedger[], env: Env) {
  const names = new Map(members.map((m) => [m.id, m.display_name]));
  const nameOf = (id: string) => names.get(id) ?? '?';
  const everyone = expense.splitType === 'equal' && expense.shares.length === members.length;
  const others = (everyone ? myLedgers : [])
    .filter((l) => l.ledger.id !== ledger.id)
    .slice(0, QUICK_REPLY_LIMIT)
    .map(({ ledger: to }) =>
      postback(`改記到 ${to.name}`, { k: 'move', l: ledger.id, e: expense.id, to: to.id }, `改記到「${to.name}」`),
    )
    .filter((c): c is QuickReplyItem => c !== null);
  return entryConfirmMessage({
    ledgerName: ledger.name,
    expense,
    payerName: nameOf(expense.payers[0]?.memberId ?? ''),
    splitText: describeSplit(expense, members, nameOf),
    editUrl: `${liffUrl(env.LIFF_ID, ledger.id)}&e=${encodeURIComponent(expense.id)}`,
    undoData: JSON.stringify({ k: 'undo', l: ledger.id, e: expense.id } satisfies Action),
    quickReply: others,
  });
}
