import { decimalsOf, evaluateAmount, SUPPORTED_CURRENCIES } from '@line-split/core';

/**
 * Parses a one-line expense sent to the bot in a private chat, e.g.
 * "午餐 1200", "1200 午餐", "拉麵 980 JPY", "披薩 450*2". The title is
 * whatever isn't the amount (and optional currency code).
 *
 * Who shares it can follow after "@": "午餐 1200 @小明 @小華" (only they
 * split it equally), "@我" for oneself, and "@小明 500" for a fixed amount
 * with the rest split among the names without one.
 */
export interface QuickEntry {
  title: string;
  /** As typed (may be arithmetic); in `currency`, or the ledger's base currency when null. */
  amount: string;
  currency: string | null;
  /** Null: everyone in the ledger splits equally. */
  participants: Participant[] | null;
}

export interface Participant {
  /** Name as typed, matched against members later ("我" = the sender). */
  name: string;
  /** Fixed amount as typed, or null to share the remainder. */
  amount: string | null;
}

const AMOUNT = String.raw`[(（]?[0-9０-９][0-9０-９,，.．+\-*/×÷xX()（）＋－＊／]*`;
const CURRENCY = String.raw`[A-Za-z]{3}`;
const TITLE_FIRST = new RegExp(String.raw`^(?<title>.+?)(?<sep>\s*)(?<amount>${AMOUNT})\s*(?<currency>${CURRENCY})?$`);
const AMOUNT_FIRST = new RegExp(String.raw`^(?<amount>${AMOUNT})\s*(?<currency>${CURRENCY})?\s+(?<title>.+)$`);
// A participant's amount needs a space before it, so names ending in a digit stay intact.
const PARTICIPANT = new RegExp(String.raw`^(?<name>.+?)(?:\s+(?<amount>${AMOUNT}))?$`);

export const MAX_TITLE = 100;

export function parseQuickEntry(text: string): QuickEntry | null {
  const line = text.trim();
  if (!line || line.includes('\n')) return null;
  const at = line.search(/[@＠]/);
  const head = (at === -1 ? line : line.slice(0, at)).trim();
  const participants = at === -1 ? null : parseParticipants(line.slice(at));
  if (participants?.length === 0) return null;

  for (const re of [TITLE_FIRST, AMOUNT_FIRST]) {
    const g = head.match(re)?.groups;
    if (!g) continue;
    const title = g.title!.trim();
    const currency = g.currency ? g.currency.toUpperCase() : null;
    if (!title || title.length > MAX_TITLE) continue;
    // "1200" alone isn't title "1" + amount "200": a title ending in a digit
    // needs a space before the amount.
    if (g.sep === '' && /[0-9０-９]$/.test(title)) continue;
    if (currency && !(SUPPORTED_CURRENCIES as readonly string[]).includes(currency)) continue;
    if (!isPositive(g.amount!, currency)) continue;
    return { title, amount: g.amount!, currency, participants };
  }
  return null;
}

/** "@小明 500 @我 @小華" → participants; [] when any part is malformed. */
function parseParticipants(tail: string): Participant[] {
  const parts = tail.split(/[@＠]/).slice(1).map((p) => p.trim());
  const participants: Participant[] = [];
  for (const part of parts) {
    const g = part.match(PARTICIPANT)?.groups;
    if (!g) return [];
    const amount = g.amount ?? null;
    if (evaluateAmount(g.name!, 2) !== null) return []; // "@ 500": a number, not a name
    if (amount !== null && evaluateAmount(amount, 2) === null) return [];
    participants.push({ name: g.name!.trim(), amount });
  }
  return participants;
}

// Validated with the currency's decimals; the base currency (unknown yet) is
// re-evaluated when the expense is created.
const isPositive = (amount: string, currency: string | null) => {
  const value = evaluateAmount(amount, currency ? decimalsOf(currency) : 2);
  return value !== null && Number(value) > 0;
};

/** An amount as a decimal string in `currency`, or null if invalid or not positive. */
export function entryAmount(amount: string, currency: string): string | null {
  const value = evaluateAmount(amount, decimalsOf(currency));
  return value !== null && Number(value) > 0 ? value : null;
}
