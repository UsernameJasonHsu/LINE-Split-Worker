import { describe, expect, it } from 'vitest';
import { allocate } from '../src/allocate';

const sum = (xs: number[]) => xs.reduce((a, b) => a + b, 0);

describe('allocate', () => {
  it('splits evenly with the remainder going to earlier entries', () => {
    expect(allocate(100, [1, 1, 1])).toEqual([34, 33, 33]);
    expect(allocate(101, [1, 1, 1])).toEqual([34, 34, 33]);
  });

  it('splits by weights using largest remainder', () => {
    // 2153 by 3334:3333:3333 → 717.81 / 717.59 / 717.59
    expect(allocate(2153, [3334, 3333, 3333])).toEqual([718, 718, 717]);
    expect(allocate(1000, [2, 1, 1])).toEqual([500, 250, 250]);
  });

  it('gives zero to zero-weight entries', () => {
    expect(allocate(10, [0, 1, 1])).toEqual([0, 5, 5]);
  });

  it('handles zero total', () => {
    expect(allocate(0, [1, 2])).toEqual([0, 0]);
  });

  it('always sums to the total', () => {
    for (const total of [1, 7, 99, 1000, 123457]) {
      for (const weights of [[1], [1, 1], [3, 5, 7], [1, 1, 1, 1, 1, 1, 1]]) {
        expect(sum(allocate(total, weights))).toBe(total);
      }
    }
  });

  it('rejects invalid input', () => {
    expect(() => allocate(10, [])).toThrow();
    expect(() => allocate(10, [0, 0])).toThrow();
    expect(() => allocate(10, [-1, 2])).toThrow();
    expect(() => allocate(-10, [1])).toThrow();
    expect(() => allocate(1.5, [1])).toThrow();
  });
});
