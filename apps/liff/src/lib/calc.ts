import { decimalsOf, evaluateAmount, isExpression, normalizeAmount } from '@line-split/core';

export { evaluateAmount, isExpression };

/**
 * Turns what the user typed into the decimal string sent to the API:
 * separators are dropped and expressions evaluated. Invalid expressions are
 * returned as typed so validation can report them.
 */
export function resolveAmount(input: string, currency: string): string {
  const plain = normalizeAmount(input);
  if (!isExpression(input)) return plain;
  return evaluateAmount(input, decimalsOf(currency)) ?? plain;
}

export type KeypadKey = string | 'backspace';

/**
 * Applies an on-screen keypad press to `value` with the caret/selection at
 * [start, end). Returns the new value and caret position.
 */
export function applyKey(
  value: string,
  start: number,
  end: number,
  key: KeypadKey,
): { value: string; caret: number } {
  if (key === 'backspace') {
    if (start !== end) return { value: value.slice(0, start) + value.slice(end), caret: start };
    if (start === 0) return { value, caret: 0 };
    return { value: value.slice(0, start - 1) + value.slice(end), caret: start - 1 };
  }
  return { value: value.slice(0, start) + key + value.slice(end), caret: start + key.length };
}
