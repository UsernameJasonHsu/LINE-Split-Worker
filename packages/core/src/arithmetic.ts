/**
 * A tiny exact calculator for amount fields ("1200+350", "3000/3").
 * Uses BigInt rationals so 0.1 + 0.2 is exactly 0.3, and rounds the result
 * half away from zero to the currency's decimals. No eval().
 */

interface Rational {
  n: bigint;
  d: bigint; // always > 0
}

const abs = (x: bigint) => (x < 0n ? -x : x);
const gcd = (a: bigint, b: bigint): bigint => (b === 0n ? abs(a) : gcd(b, a % b));

function rational(n: bigint, d: bigint): Rational {
  if (d < 0n) [n, d] = [-n, -d];
  const g = gcd(n, d) || 1n;
  return { n: n / g, d: d / g };
}

const add = (a: Rational, b: Rational) => rational(a.n * b.d + b.n * a.d, a.d * b.d);
const sub = (a: Rational, b: Rational) => rational(a.n * b.d - b.n * a.d, a.d * b.d);
const mul = (a: Rational, b: Rational) => rational(a.n * b.n, a.d * b.d);
const div = (a: Rational, b: Rational) => (b.n === 0n ? null : rational(a.n * b.d, a.d * b.n));

const FULL_WIDTH: Record<string, string> = {
  '＋': '+',
  '－': '-',
  '−': '-',
  '×': '*',
  '＊': '*',
  x: '*',
  X: '*',
  '÷': '/',
  '／': '/',
  '（': '(',
  '）': ')',
  '．': '.',
};

/** Half-width digits/operators, without separators or whitespace. */
export function normalizeAmount(input: string): string {
  return input
    .replace(/[０-９]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0xfee0))
    .replace(/[＋－−×＊xX÷／（）．]/g, (c) => FULL_WIDTH[c]!)
    .replace(/[,，\s]/g, '');
}

export function isExpression(input: string): boolean {
  return /[+\-*/()]/.test(normalizeAmount(input));
}

/** Recursive-descent parser: expr = term (± term)*, term = factor (×÷ factor)*. */
function parse(src: string): Rational | null {
  const tokens = src.match(/\d*\.\d+|\d+\.?|[+\-*/()]|./g) ?? [];
  let i = 0;
  const peek = () => tokens[i];

  function number(tok: string): Rational | null {
    if (!/^(\d+(\.\d*)?|\.\d+)$/.test(tok)) return null;
    const [int = '', frac = ''] = tok.split('.');
    return rational(BigInt((int || '0') + frac), 10n ** BigInt(frac.length));
  }

  function factor(): Rational | null {
    const tok = tokens[i++];
    if (tok === undefined) return null;
    if (tok === '+') return factor();
    if (tok === '-') {
      const f = factor();
      return f && rational(-f.n, f.d);
    }
    if (tok === '(') {
      const e = expr();
      if (e === null || tokens[i++] !== ')') return null;
      return e;
    }
    return number(tok);
  }

  function term(): Rational | null {
    let left = factor();
    while (left && (peek() === '*' || peek() === '/')) {
      const op = tokens[i++];
      const right = factor();
      if (!right) return null;
      left = op === '*' ? mul(left, right) : div(left, right);
    }
    return left;
  }

  function expr(): Rational | null {
    let left = term();
    while (left && (peek() === '+' || peek() === '-')) {
      const op = tokens[i++];
      const right = term();
      if (!right) return null;
      left = op === '+' ? add(left, right) : sub(left, right);
    }
    return left;
  }

  const result = expr();
  return result && i === tokens.length ? result : null;
}

function toFixed({ n, d }: Rational, decimals: number): string {
  const scaled = abs(n) * 10n ** BigInt(decimals);
  let q = scaled / d;
  if ((scaled % d) * 2n >= d) q += 1n;
  const digits = q.toString().padStart(decimals + 1, '0');
  const sign = n < 0n && q !== 0n ? '-' : '';
  return decimals === 0 ? sign + digits : `${sign}${digits.slice(0, -decimals)}.${digits.slice(-decimals)}`;
}

/** Evaluates an arithmetic expression to a decimal string, or null if invalid. */
export function evaluateAmount(input: string, decimals: number): string | null {
  const src = normalizeAmount(input);
  if (!src) return null;
  const value = parse(src);
  return value ? toFixed(value, decimals) : null;
}
