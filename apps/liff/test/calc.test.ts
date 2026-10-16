import { describe, expect, it } from 'vitest';
import { evaluateAmount, isExpression, resolveAmount } from '../src/lib/calc';

describe('evaluateAmount', () => {
  it('does arithmetic with precedence and parentheses', () => {
    expect(evaluateAmount('1200+350', 0)).toBe('1550');
    expect(evaluateAmount('1,200 + 350', 0)).toBe('1550');
    expect(evaluateAmount('(80+120)*2', 0)).toBe('400');
    expect(evaluateAmount('100-20*3', 0)).toBe('40');
  });

  it('rounds half away from zero to the currency decimals, exactly', () => {
    expect(evaluateAmount('3000/3', 0)).toBe('1000');
    expect(evaluateAmount('100/3', 0)).toBe('33');
    expect(evaluateAmount('10/4', 0)).toBe('3'); // 2.5 → 3
    expect(evaluateAmount('100/3', 2)).toBe('33.33');
    expect(evaluateAmount('1.005*1', 2)).toBe('1.01'); // no float error (1.005 is exact here)
    expect(evaluateAmount('.5+.5', 2)).toBe('1.00');
    expect(evaluateAmount('0.1+0.2', 2)).toBe('0.30');
  });

  it('accepts full-width input and × ÷', () => {
    expect(evaluateAmount('１２０×３', 0)).toBe('360');
    expect(evaluateAmount('90÷3', 0)).toBe('30');
    expect(evaluateAmount('（１＋２）＊３', 0)).toBe('9');
    expect(evaluateAmount('2x3', 0)).toBe('6');
  });

  it('returns null for invalid expressions', () => {
    for (const bad of ['', '5/0', '1++', '2*(3', '(1)(2)', 'abc', '1.2.3', '*3']) {
      expect(evaluateAmount(bad, 0), bad).toBeNull();
    }
  });

  it('allows unary signs', () => {
    expect(evaluateAmount('-5+8', 0)).toBe('3');
    expect(evaluateAmount('-5', 0)).toBe('-5');
  });
});

describe('isExpression / resolveAmount', () => {
  it('only treats input with operators as an expression', () => {
    expect(isExpression('1200')).toBe(false);
    expect(isExpression('1,200')).toBe(false);
    expect(isExpression('１２００')).toBe(false);
    expect(isExpression('1200+350')).toBe(true);
    expect(isExpression('3×2')).toBe(true);
  });

  it('resolves plain numbers and expressions to a decimal string', () => {
    expect(resolveAmount(' 1,200 ', 'TWD')).toBe('1200');
    expect(resolveAmount('１２００', 'TWD')).toBe('1200');
    expect(resolveAmount('1200+350', 'TWD')).toBe('1550');
    expect(resolveAmount('10/3', 'USD')).toBe('3.33');
    // Broken expressions are passed through so validation can explain.
    expect(resolveAmount('5/0', 'TWD')).toBe('5/0');
  });
});
