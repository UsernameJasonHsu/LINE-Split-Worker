/**
 * Splits free-text payment info into lines and finds the account / phone
 * numbers in each, so they can be copied on their own (digits only, ready to
 * paste into a banking app).
 */

export interface PaymentLine {
  text: string;
  /** Numbers found in the line, as typed and as digits only. */
  numbers: { text: string; digits: string }[];
}

// Groups of 4+ digits joined by spaces ("1234 5678 9012"), or digits joined by
// dashes ("0912-345-678"). A 3-digit bank code before a space stays separate.
const NUMBER = /\d{4,}(?: \d{4,})+|\d+(?:-\d+)*/g;
const MIN_DIGITS = 6;

export function parsePaymentInfo(info: string): PaymentLine[] {
  return info
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((text) => {
      const normalized = text.replace(/[０-９]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0xfee0));
      const numbers = [...normalized.matchAll(NUMBER)]
        .map((m) => ({ text: m[0], digits: m[0].replace(/\D/g, '') }))
        .filter((n) => n.digits.length >= MIN_DIGITS);
      return { text, numbers };
    });
}
