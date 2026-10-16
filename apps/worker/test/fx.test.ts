import { describe, expect, it } from 'vitest';
import { rateToString, taipeiDate } from '../src/fx';

describe('rateToString', () => {
  it('produces plain decimal strings', () => {
    expect(rateToString(0.2153)).toBe('0.2153');
    expect(rateToString(32.5)).toBe('32.5');
    expect(rateToString(150)).toBe('150');
    expect(rateToString(1.5e-7)).toBe('0.00000015');
  });

  it('rejects non-positive values', () => {
    expect(() => rateToString(0)).toThrow();
    expect(() => rateToString(Number.NaN)).toThrow();
  });
});

describe('taipeiDate', () => {
  it('uses UTC+8', () => {
    expect(taipeiDate(Date.UTC(2026, 9, 16, 15, 59))).toBe('2026-10-16');
    expect(taipeiDate(Date.UTC(2026, 9, 16, 16, 0))).toBe('2026-10-17');
  });
});
