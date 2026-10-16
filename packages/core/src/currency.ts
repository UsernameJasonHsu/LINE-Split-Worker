/**
 * Practical minor-unit decimals per currency. TWD/IDR are 2 in ISO 4217 but
 * are never used with decimals in practice, so we treat them as 0.
 */
const DECIMALS: Record<string, number> = {
  TWD: 0,
  JPY: 0,
  KRW: 0,
  VND: 0,
  IDR: 0,
  USD: 2,
  EUR: 2,
  GBP: 2,
  HKD: 2,
  MOP: 2,
  CNY: 2,
  SGD: 2,
  THB: 2,
  MYR: 2,
  PHP: 2,
  AUD: 2,
  NZD: 2,
  CAD: 2,
  CHF: 2,
};

export const SUPPORTED_CURRENCIES = Object.keys(DECIMALS);

export function decimalsOf(currency: string): number {
  const d = DECIMALS[currency];
  if (d === undefined) throw new Error(`Unsupported currency: ${currency}`);
  return d;
}

/** An exchange rate as an exact decimal: value = digits / 10^scale. */
export interface Rate {
  digits: bigint;
  scale: number;
}

const UNSIGNED_DECIMAL = /^\d+(?:\.\d+)?$/;
const SIGNED_DECIMAL = /^-?\d+(?:\.\d+)?$/;

export function parseRate(rate: string): Rate {
  if (!UNSIGNED_DECIMAL.test(rate)) throw new Error(`Invalid rate: ${rate}`);
  const [int = '', frac = ''] = rate.split('.');
  const digits = BigInt(int + frac);
  if (digits === 0n) throw new Error(`Invalid rate: ${rate}`);
  return { digits, scale: frac.length };
}

export function isUnitRate(rate: string): boolean {
  const { digits, scale } = parseRate(rate);
  return digits === 10n ** BigInt(scale);
}

export function assertSafeInteger(n: number, label: string): void {
  if (!Number.isSafeInteger(n)) throw new Error(`${label} must be a safe integer, got ${n}`);
}

/** Parses a user-entered decimal string ("12.34") into minor units. */
export function toMinor(amount: string, currency: string): number {
  const decimals = decimalsOf(currency);
  if (!SIGNED_DECIMAL.test(amount)) throw new Error(`Invalid amount: ${amount}`);
  const [int = '', frac = ''] = amount.split('.');
  if (frac.length > decimals) {
    throw new Error(`${currency} allows at most ${decimals} decimal places: ${amount}`);
  }
  const minor = Number(int + frac.padEnd(decimals, '0'));
  assertSafeInteger(minor, 'amount');
  return minor;
}

export function formatMinor(minor: number, currency: string): string {
  const decimals = decimalsOf(currency);
  const sign = minor < 0 ? '-' : '';
  const abs = String(Math.abs(minor));
  if (decimals === 0) return sign + abs;
  const padded = abs.padStart(decimals + 1, '0');
  return `${sign}${padded.slice(0, -decimals)}.${padded.slice(-decimals)}`;
}

/** Display format with code and thousands separators, e.g. "TWD 1,234". */
export function formatMoney(minor: number, currency: string): string {
  const [int = '', frac] = formatMinor(Math.abs(minor), currency).split('.');
  const grouped = int.replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  return `${minor < 0 ? '-' : ''}${currency} ${grouped}${frac ? `.${frac}` : ''}`;
}

/** Integer division rounding half away from zero. `den` must be positive. */
function roundDiv(num: bigint, den: bigint): bigint {
  const neg = num < 0n;
  const abs = neg ? -num : num;
  let q = abs / den;
  if ((abs % den) * 2n >= den) q += 1n;
  return neg ? -q : q;
}

/**
 * Converts minor units of `from` into minor units of `to`, where
 * `rate` is how many `to` units one `from` unit is worth.
 */
export function convertMinor(amountMinor: number, from: string, to: string, rate: string): number {
  assertSafeInteger(amountMinor, 'amountMinor');
  const { digits, scale } = parseRate(rate);
  const num = BigInt(amountMinor) * digits * 10n ** BigInt(decimalsOf(to));
  const den = 10n ** BigInt(scale + decimalsOf(from));
  const result = Number(roundDiv(num, den));
  assertSafeInteger(result, 'converted amount');
  return result;
}
