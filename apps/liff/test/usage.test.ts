import { describe, expect, it } from 'vitest';
import { formatBytes } from '../src/views/UsageCard';

describe('formatBytes', () => {
  it('picks a readable unit', () => {
    expect(formatBytes(512)).toBe('512 B');
    expect(formatBytes(152 * 1024)).toBe('152.0 KB');
    expect(formatBytes(500 * 1024 * 1024)).toBe('500.0 MB');
    expect(formatBytes(5 * 1024 ** 3)).toBe('5.00 GB');
  });
});
