import { allocate } from './allocate';
import { assertSafeInteger, convertMinor, decimalsOf, isUnitRate } from './currency';

export type Split =
  | { type: 'equal'; memberIds: string[] }
  | { type: 'weights'; items: { memberId: string; weight: number }[] }
  | { type: 'exact'; items: { memberId: string; amountMinor: number }[] };

export interface ExpenseInput {
  currency: string;
  /** Total in minor units of `currency`. */
  amountMinor: number;
  /** How many `baseCurrency` units one `currency` unit is worth, e.g. "0.2153". */
  fxRate: string;
  baseCurrency: string;
  payers: { memberId: string; amountMinor: number }[];
  split: Split;
}

export interface ComputedPayer {
  memberId: string;
  amountMinor: number;
  baseAmountMinor: number;
}

export interface ComputedShare {
  memberId: string;
  shareMinor: number;
  baseShareMinor: number;
}

export interface ComputedExpense {
  currency: string;
  amountMinor: number;
  fxRate: string;
  baseCurrency: string;
  baseAmountMinor: number;
  payers: ComputedPayer[];
  shares: ComputedShare[];
}

function assertUniqueMembers(ids: string[], label: string): void {
  if (new Set(ids).size !== ids.length) throw new Error(`${label} contain duplicate members`);
}

function computeShareMinors(amountMinor: number, split: Split): { memberId: string; minor: number }[] {
  switch (split.type) {
    case 'equal': {
      if (split.memberIds.length === 0) throw new Error('Split must include at least one member');
      assertUniqueMembers(split.memberIds, 'Split');
      const minors = allocate(amountMinor, split.memberIds.map(() => 1));
      return split.memberIds.map((memberId, i) => ({ memberId, minor: minors[i]! }));
    }
    case 'weights': {
      if (split.items.length === 0) throw new Error('Split must include at least one member');
      assertUniqueMembers(split.items.map((x) => x.memberId), 'Split');
      const minors = allocate(amountMinor, split.items.map((x) => x.weight));
      return split.items.map(({ memberId }, i) => ({ memberId, minor: minors[i]! }));
    }
    case 'exact': {
      if (split.items.length === 0) throw new Error('Split must include at least one member');
      assertUniqueMembers(split.items.map((x) => x.memberId), 'Split');
      let sum = 0;
      for (const { amountMinor: a } of split.items) {
        assertSafeInteger(a, 'split amount');
        if (a < 0) throw new Error(`Split amount must be non-negative, got ${a}`);
        sum += a;
      }
      if (sum !== amountMinor) {
        throw new Error(`Split amounts sum to ${sum}, expected ${amountMinor}`);
      }
      return split.items.map(({ memberId, amountMinor: minor }) => ({ memberId, minor }));
    }
  }
}

/**
 * Validates an expense and computes every payer's and share's amount in both
 * the original currency and the ledger's base currency. Base-currency parts are
 * allocated from the converted total, so they always sum to `baseAmountMinor`.
 */
export function computeExpense(input: ExpenseInput): ComputedExpense {
  const { currency, amountMinor, fxRate, baseCurrency, payers, split } = input;

  decimalsOf(currency);
  decimalsOf(baseCurrency);
  assertSafeInteger(amountMinor, 'amountMinor');
  if (amountMinor <= 0) throw new Error(`amountMinor must be positive, got ${amountMinor}`);
  if (currency === baseCurrency && !isUnitRate(fxRate)) {
    throw new Error(`fxRate must be 1 when currency equals base currency, got ${fxRate}`);
  }

  if (payers.length === 0) throw new Error('Payers must not be empty');
  assertUniqueMembers(payers.map((p) => p.memberId), 'Payers');
  let paid = 0;
  for (const p of payers) {
    assertSafeInteger(p.amountMinor, 'payer amount');
    if (p.amountMinor <= 0) throw new Error(`Payer amount must be positive, got ${p.amountMinor}`);
    paid += p.amountMinor;
  }
  if (paid !== amountMinor) throw new Error(`Payers sum to ${paid}, expected ${amountMinor}`);

  const shareMinors = computeShareMinors(amountMinor, split);

  const baseAmountMinor = convertMinor(amountMinor, currency, baseCurrency, fxRate);
  const basePaid = allocate(baseAmountMinor, payers.map((p) => p.amountMinor));
  const baseShares = allocate(baseAmountMinor, shareMinors.map((s) => s.minor));

  return {
    currency,
    amountMinor,
    fxRate,
    baseCurrency,
    baseAmountMinor,
    payers: payers.map((p, i) => ({
      memberId: p.memberId,
      amountMinor: p.amountMinor,
      baseAmountMinor: basePaid[i]!,
    })),
    shares: shareMinors.map((s, i) => ({
      memberId: s.memberId,
      shareMinor: s.minor,
      baseShareMinor: baseShares[i]!,
    })),
  };
}
