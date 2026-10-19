import { describe, expect, it } from 'vitest';
import { parsePaymentInfo } from '../src/lib/payment';

const digitsOf = (info: string) => parsePaymentInfo(info).map((l) => l.numbers.map((n) => n.digits));

describe('parsePaymentInfo', () => {
  it('finds account and phone numbers per line, as digits only', () => {
    expect(digitsOf('中國信託 (822) 1234-5678-9012\nLINE Pay：0912-345-678')).toEqual([
      ['123456789012'],
      ['0912345678'],
    ]);
  });

  it('keeps a bank code separate from a space-grouped account number', () => {
    expect(digitsOf('822 1234 5678 9012')).toEqual([['123456789012']]);
    expect(digitsOf('國泰 013-123456789012')).toEqual([['013123456789012']]);
  });

  it('accepts full-width digits and ignores short numbers', () => {
    expect(digitsOf('郵局 ７００ ００１２３４５６７８９０')).toEqual([['001234567890']]);
    expect(digitsOf('LINE ID: ryan99')).toEqual([[]]);
  });

  it('drops blank lines and keeps the text as typed', () => {
    expect(parsePaymentInfo('  a 123456 \n\n b ')).toEqual([
      { text: 'a 123456', numbers: [{ text: '123456', digits: '123456' }] },
      { text: 'b', numbers: [] },
    ]);
  });
});
