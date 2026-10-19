import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { decimalsOf, formatMoney, toMinor } from '@line-split/core';
import { applyKey, evaluateAmount, isExpression, type KeypadKey } from './lib/calc';

// 5×4 grid: digits on the left, operators on the right.
const KEYPAD: { key: KeypadKey | 'equals' | 'done'; label: string; kind?: 'op' | 'action' }[] = [
  { key: '7', label: '7' },
  { key: '8', label: '8' },
  { key: '9', label: '9' },
  { key: '÷', label: '÷', kind: 'op' },
  { key: 'backspace', label: '⌫', kind: 'op' },
  { key: '4', label: '4' },
  { key: '5', label: '5' },
  { key: '6', label: '6' },
  { key: '×', label: '×', kind: 'op' },
  { key: '(', label: '(', kind: 'op' },
  { key: '1', label: '1' },
  { key: '2', label: '2' },
  { key: '3', label: '3' },
  { key: '−', label: '−', kind: 'op' },
  { key: ')', label: ')', kind: 'op' },
  { key: '.', label: '.' },
  { key: '0', label: '0' },
  { key: 'equals', label: '=', kind: 'op' },
  { key: '+', label: '+', kind: 'op' },
  { key: 'done', label: '完成', kind: 'action' },
];

const KEY_LABELS: Record<string, string> = { backspace: '刪除', equals: '計算結果', done: '完成' };

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

const isTouch = () => typeof window !== 'undefined' && window.matchMedia?.('(pointer: coarse)').matches;

/**
 * Amount field that accepts simple arithmetic ("1200+350"). Shows the result
 * while typing and replaces the expression with it on blur. Phone number pads
 * lack operators, so on touch devices `withKeys` swaps the system keyboard for
 * an on-screen calculator keypad with digits and operators.
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
  const decimals = decimalsOf(currency);
  const useKeypad = withKeys && isTouch();
  const [open, setOpen] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const keypadRef = useRef<HTMLDivElement>(null);
  // Set while a keypad key is pressed, so the resulting blur keeps the keypad open.
  const pressing = useRef(false);
  const pendingCaret = useRef<number | null>(null);

  const preview = previewOf(value, currency);
  const commit = () => {
    if (!isExpression(value)) return;
    const result = evaluateAmount(value, decimals);
    if (result !== null) onChange(result);
  };

  useLayoutEffect(() => {
    const caret = pendingCaret.current;
    if (caret === null || !inputRef.current) return;
    pendingCaret.current = null;
    inputRef.current.setSelectionRange(caret, caret);
  }, [value]);

  useEffect(() => {
    if (!open) return;
    document.body.classList.add('keypad-open');
    inputRef.current?.scrollIntoView({ block: 'center', behavior: 'smooth' });
    // Tapping elsewhere doesn't always blur the input (iOS), so close explicitly.
    const onOutside = (e: PointerEvent) => {
      const target = e.target as Node;
      if (inputRef.current?.contains(target) || keypadRef.current?.contains(target)) return;
      pressing.current = false;
      inputRef.current?.blur();
      setOpen(false);
    };
    document.addEventListener('pointerdown', onOutside);
    return () => {
      document.body.classList.remove('keypad-open');
      document.removeEventListener('pointerdown', onOutside);
    };
  }, [open]);

  // Commit once the keypad closes, however it was closed.
  const wasOpen = useRef(false);
  useEffect(() => {
    if (wasOpen.current && !open) commit();
    wasOpen.current = open;
  }, [open]); // eslint-disable-line react-hooks/exhaustive-deps

  const press = (key: (typeof KEYPAD)[number]['key']) => {
    pressing.current = false;
    const input = inputRef.current;
    if (key === 'done') {
      setOpen(false);
      input?.blur();
      return;
    }
    if (key === 'equals') {
      commit();
    } else {
      const start = input?.selectionStart ?? value.length;
      const end = input?.selectionEnd ?? value.length;
      const next = applyKey(value, start, end, key);
      pendingCaret.current = next.caret;
      onChange(next.value);
    }
    if (input && document.activeElement !== input) input.focus({ preventScroll: true });
  };

  // Keep focus in the input while tapping keys.
  const holdFocus = (e: React.SyntheticEvent) => {
    pressing.current = true;
    e.preventDefault();
  };

  return (
    <span className="amount-field">
      <input
        ref={inputRef}
        className={className}
        inputMode={useKeypad ? 'none' : decimals === 0 ? 'numeric' : 'decimal'}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        onFocus={() => useKeypad && setOpen(true)}
        onClick={() => useKeypad && setOpen(true)}
        onBlur={() => {
          if (pressing.current) return;
          if (open) setOpen(false);
          else commit();
        }}
        onKeyDown={(e) => e.key === 'Enter' && commit()}
        placeholder={placeholder}
        aria-label={ariaLabel}
      />
      {preview && <small className="calc-preview">= {preview}</small>}
      {open &&
        createPortal(
          <div ref={keypadRef} className="keypad" role="group" aria-label="金額鍵盤" onPointerDown={holdFocus} onMouseDown={holdFocus}>
            {KEYPAD.map(({ key, label, kind }) => (
              <button
                key={key}
                type="button"
                className={kind}
                onClick={() => press(key)}
                disabled={(key === '.' && decimals === 0) || (key === 'equals' && !preview)}
                aria-label={KEY_LABELS[key] ?? `輸入 ${label}`}
              >
                {label}
              </button>
            ))}
          </div>,
          document.body,
        )}
    </span>
  );
}
