import { parseSentence, type ParsedSentence } from '@line-split/core';
import type { Member } from '../api';
import type { ExpenseForm } from './form';

/** Form fields a sentence can fill; once the user edits one by hand it is left alone. */
export type SentenceField = 'amount' | 'currency' | 'title' | 'payer' | 'split';

export function parseForForm(text: string, members: Member[], meId: string): ParsedSentence {
  return parseSentence(
    text,
    members.map((m) => ({ id: m.id, name: m.displayName })),
    meId,
  );
}

/**
 * The form fields implied by the sentence, for fields not edited by hand.
 * What the sentence doesn't say falls back to the defaults (me paying,
 * everyone splitting), so deleting words undoes what they filled in.
 */
export function sentencePatch(
  parsed: ParsedSentence,
  touched: ReadonlySet<SentenceField>,
  members: Member[],
  meId: string,
  baseCurrency: string,
): Partial<ExpenseForm> {
  const patch: Partial<ExpenseForm> = {};
  if (!touched.has('amount')) patch.amount = parsed.amount ?? '';
  if (!touched.has('title')) patch.title = parsed.title ?? '';
  if (!touched.has('currency')) patch.currency = parsed.currency ?? baseCurrency;
  if (!touched.has('payer')) {
    patch.payerId = parsed.payerId ?? meId;
    patch.multiPayer = false;
  }
  if (!touched.has('split')) {
    const all = members.map((m) => m.id);
    const split = parsed.split;
    patch.splitType = 'equal';
    patch.equalIds =
      split?.kind === 'only'
        ? split.memberIds
        : split?.kind === 'except'
          ? all.filter((id) => !split.memberIds.includes(id))
          : all;
  }
  return patch;
}

/** e.g. "認出：TWD 300・小明付・我、小華分" — what the sentence was understood as. */
export function describeParsed(parsed: ParsedSentence, nameOf: (id: string) => string, baseCurrency: string): string {
  const parts: string[] = [];
  if (parsed.amount) parts.push(`${parsed.currency ?? baseCurrency} ${parsed.amount}`);
  if (parsed.title) parts.push(`「${parsed.title}」`);
  if (parsed.payerId) parts.push(`${nameOf(parsed.payerId)}付`);
  const split = parsed.split;
  if (split?.kind === 'all') parts.push('大家分');
  if (split?.kind === 'only') parts.push(`${split.memberIds.map(nameOf).join('、')}分`);
  if (split?.kind === 'except') parts.push(`除了${split.memberIds.map(nameOf).join('、')}`);
  if (!parsed.amount) parts.push('還沒找到金額');
  return parts.join('・');
}
