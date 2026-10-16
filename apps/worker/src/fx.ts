import { decimalsOf, SUPPORTED_CURRENCIES } from '@line-split/core';
import { HttpError } from './errors';
import { http } from './http';

const PROVIDER = 'open.er-api.com';

export interface FxQuote {
  rate: string;
  source: string;
  date: string;
}

/** Calendar date in Asia/Taipei (UTC+8, no DST). */
export function taipeiDate(now = Date.now()): string {
  return new Date(now + 8 * 3600_000).toISOString().slice(0, 10);
}

/** Converts a provider float into a plain decimal string accepted by parseRate. */
export function rateToString(n: number): string {
  if (!Number.isFinite(n) || n <= 0) throw new Error(`Invalid provider rate: ${n}`);
  const precise = n.toPrecision(10);
  const plain = /e/i.test(precise) ? n.toFixed(12) : precise;
  return plain.includes('.') ? plain.replace(/0+$/, '').replace(/\.$/, '') : plain;
}

/**
 * Mid-market rate for 1 unit of `from` in `to`, cached per Taipei calendar day.
 * One provider call caches `from` against every supported currency.
 */
export async function getFxRate(db: D1Database, from: string, to: string, now = Date.now()): Promise<FxQuote> {
  decimalsOf(from);
  decimalsOf(to);
  const date = taipeiDate(now);
  if (from === to) return { rate: '1', source: 'identity', date };

  const cached = await db
    .prepare('SELECT rate, source FROM fx_rates WHERE date = ? AND from_currency = ? AND to_currency = ?')
    .bind(date, from, to)
    .first<{ rate: string; source: string }>();
  if (cached) return { ...cached, date };

  const res = await http.fetch(`https://open.er-api.com/v6/latest/${from}`);
  if (!res.ok) throw new HttpError(502, 'Exchange rate provider unavailable');
  const data = await res.json<{ result: string; rates?: Record<string, number> }>();
  if (data.result !== 'success' || !data.rates) throw new HttpError(502, 'Exchange rate provider returned an error');

  let found: string | undefined;
  const inserts: D1PreparedStatement[] = [];
  for (const cur of SUPPORTED_CURRENCIES) {
    const value = data.rates[cur];
    if (cur === from || value === undefined) continue;
    const rate = rateToString(value);
    if (cur === to) found = rate;
    inserts.push(
      db
        .prepare(
          'INSERT OR REPLACE INTO fx_rates (date, from_currency, to_currency, rate, source, fetched_at) VALUES (?, ?, ?, ?, ?, ?)',
        )
        .bind(date, from, cur, rate, PROVIDER, now),
    );
  }
  if (!found) throw new HttpError(502, `No exchange rate for ${from} → ${to}`);
  await db.batch(inserts);
  return { rate: found, source: PROVIDER, date };
}
