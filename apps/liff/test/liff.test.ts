import { describe, expect, it, vi } from 'vitest';

vi.mock('@line/liff', () => ({ default: {} }));
const { ledgerIdFromUrl } = await import('../src/liff');

describe('ledgerIdFromUrl', () => {
  it('reads the l parameter', () => {
    expect(ledgerIdFromUrl('?l=abc-123')).toBe('abc-123');
  });

  it('reads it from liff.state before the secondary redirect', () => {
    expect(ledgerIdFromUrl(`?liff.state=${encodeURIComponent('?l=abc-123')}`)).toBe('abc-123');
    expect(ledgerIdFromUrl(`?liff.state=${encodeURIComponent('/path?l=abc-123')}`)).toBe('abc-123');
  });

  it('returns null when absent', () => {
    expect(ledgerIdFromUrl('')).toBeNull();
    expect(ledgerIdFromUrl(`?liff.state=${encodeURIComponent('/somewhere')}`)).toBeNull();
  });
});

describe('urlParam', () => {
  it('reads other parameters, including from liff.state', async () => {
    const { urlParam } = await import('../src/liff');
    expect(urlParam('view', '?view=feedback&l=x')).toBe('feedback');
    expect(urlParam('view', `?liff.state=${encodeURIComponent('?view=admin')}`)).toBe('admin');
    expect(urlParam('view', '?l=x')).toBeNull();
  });
});
