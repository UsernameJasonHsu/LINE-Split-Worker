import { describe, expect, it } from 'vitest';
import { convertMinor, decimalsOf, parseRate, toMinor, formatMinor, formatMoney } from '../src/currency';

describe('formatMoney', () => {
  it('adds currency code and thousands separators', () => {
    expect(formatMoney(1234567, 'TWD')).toBe('TWD 1,234,567');
    expect(formatMoney(123456, 'USD')).toBe('USD 1,234.56');
    expect(formatMoney(-5, 'USD')).toBe('-USD 0.05');
    expect(formatMoney(0, 'JPY')).toBe('JPY 0');
  });
});

describe('decimalsOf', () => {
  it('uses practical decimals for TWD and JPY, two for USD', () => {
    expect(decimalsOf('TWD')).toBe(0);
    expect(decimalsOf('JPY')).toBe(0);
    expect(decimalsOf('USD')).toBe(2);
  });

  it('rejects unknown currencies', () => {
    expect(() => decimalsOf('XXX')).toThrow(/unsupported currency/i);
  });
});

describe('parseRate', () => {
  it('parses decimal strings', () => {
    expect(parseRate('0.2153')).toEqual({ digits: 2153n, scale: 4 });
    expect(parseRate('32')).toEqual({ digits: 32n, scale: 0 });
  });

  it('rejects zero, negative and malformed rates', () => {
    for (const bad of ['0', '0.000', '-1', 'abc', '', '1e3', '1.']) {
      expect(() => parseRate(bad), bad).toThrow(/invalid rate/i);
    }
  });
});

describe('toMinor / formatMinor', () => {
  it('converts decimal strings to minor units', () => {
    expect(toMinor('12.34', 'USD')).toBe(1234);
    expect(toMinor('12.3', 'USD')).toBe(1230);
    expect(toMinor('1200', 'TWD')).toBe(1200);
  });

  it('rejects too many decimals', () => {
    expect(() => toMinor('12.345', 'USD')).toThrow();
    expect(() => toMinor('12.5', 'TWD')).toThrow();
  });

  it('formats minor units', () => {
    expect(formatMinor(1234, 'USD')).toBe('12.34');
    expect(formatMinor(-5, 'USD')).toBe('-0.05');
    expect(formatMinor(1200, 'TWD')).toBe('1200');
  });
});

describe('convertMinor', () => {
  it('converts JPY to TWD with rounding', () => {
    // ¥10,000 × 0.2153 = NT$2,153
    expect(convertMinor(10000, 'JPY', 'TWD', '0.2153')).toBe(2153);
    // ¥1,234 × 0.2153 = 265.68 → 266
    expect(convertMinor(1234, 'JPY', 'TWD', '0.2153')).toBe(266);
  });

  it('accounts for differing decimals (USD → TWD)', () => {
    // $12.34 × 32.5 = NT$401.05 → 401
    expect(convertMinor(1234, 'USD', 'TWD', '32.5')).toBe(401);
  });

  it('accounts for differing decimals (TWD → USD)', () => {
    // NT$100 × 0.0307 = $3.07
    expect(convertMinor(100, 'TWD', 'USD', '0.0307')).toBe(307);
  });

  it('rounds half away from zero', () => {
    // 5 × 0.5 = 2.5 → 3
    expect(convertMinor(5, 'TWD', 'TWD', '0.5')).toBe(3);
    expect(convertMinor(-5, 'TWD', 'TWD', '0.5')).toBe(-3);
  });

  it('is identity for same currency at rate 1', () => {
    expect(convertMinor(4321, 'TWD', 'TWD', '1')).toBe(4321);
  });
});
