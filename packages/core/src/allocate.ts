import { assertSafeInteger } from './currency';

/**
 * Splits a non-negative integer `total` proportionally to `weights` using the
 * largest remainder method. The result always sums to `total`; ties on the
 * remainder go to the earlier entry so results are deterministic.
 */
export function allocate(total: number, weights: number[]): number[] {
  assertSafeInteger(total, 'total');
  if (total < 0) throw new Error(`total must be non-negative, got ${total}`);
  if (weights.length === 0) throw new Error('weights must not be empty');
  for (const w of weights) {
    assertSafeInteger(w, 'weight');
    if (w < 0) throw new Error(`weight must be non-negative, got ${w}`);
  }

  const big = weights.map(BigInt);
  const sumW = big.reduce((a, b) => a + b, 0n);
  if (sumW === 0n) throw new Error('weights must not all be zero');

  const t = BigInt(total);
  const parts = big.map((w) => (t * w) / sumW);
  const remainders = big.map((w, i) => ({ i, r: (t * w) % sumW }));
  let leftover = Number(t - parts.reduce((a, b) => a + b, 0n));

  remainders.sort((a, b) => (a.r === b.r ? a.i - b.i : a.r > b.r ? -1 : 1));
  for (const { i } of remainders) {
    if (leftover === 0) break;
    parts[i]! += 1n;
    leftover -= 1;
  }
  return parts.map(Number);
}
