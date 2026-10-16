import { decimalsOf, formatMoney, toMinor } from '@line-split/core';
import { evaluateAmount, isExpression } from './lib/calc';

const KEYS = ['+', '−', '×', '÷', '(', ')'];

function previewOf(value: string, currency: string): string | null {
  if (!isExpression(value)) return null;
  const result = evaluateAmount(value, decimalsOf(currency));
  if (result === null) return null;
  try {
    return formatMoney(toMinor(result, currency), currency);
  } catch {
    return null;
  }
}

/**
 * Amount field that accepts simple arithmetic ("1200+350"). Shows the result
 * while typing and replaces the expression with it on blur. Phone number pads
 * lack operators, so `withKeys` adds an operator row.
 */
export function AmountInput({
  value,
  onChange,
  currency,
  className,
  placeholder = '0',
  ariaLabel,
  withKeys = false,
}: {
  value: string;
  onChange: (value: string) => void;
  currency: string;
  className?: string;
  placeholder?: string;
  ariaLabel?: string;
  withKeys?: boolean;
}) {
  const preview = previewOf(value, currency);
  const commit = () => {
    if (!isExpression(value)) return;
    const result = evaluateAmount(value, decimalsOf(currency));
    if (result !== null) onChange(result);
  };

  return (
    <span className="amount-field">
      <input
        className={className}
        inputMode={decimalsOf(currency) === 0 ? 'numeric' : 'decimal'}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => e.key === 'Enter' && commit()}
        placeholder={placeholder}
        aria-label={ariaLabel}
      />
      {preview && <small className="calc-preview">= {preview}</small>}
      {withKeys && (
        <span className="calc-keys">
          {KEYS.map((k) => (
            <button
              key={k}
              type="button"
              // Keep focus (and the keyboard) in the input while tapping operators.
              onPointerDown={(e) => e.preventDefault()}
              onClick={() => onChange(value + k)}
              aria-label={`輸入 ${k}`}
            >
              {k}
            </button>
          ))}
          <button
            type="button"
            className="calc-equals"
            onPointerDown={(e) => e.preventDefault()}
            onClick={commit}
            disabled={!preview}
            aria-label="計算結果"
          >
            =
          </button>
        </span>
      )}
    </span>
  );
}
