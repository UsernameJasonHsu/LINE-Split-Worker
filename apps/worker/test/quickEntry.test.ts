import { describe, expect, it } from 'vitest';
import { entryAmount, parseQuickEntry } from '../src/quickEntry';

describe('parseQuickEntry', () => {
  it('reads title and amount in either order', () => {
    expect(parseQuickEntry('午餐 1200')).toEqual({ title: '午餐', amount: '1200', currency: null, participants: null });
    expect(parseQuickEntry('午餐1200')).toEqual({ title: '午餐', amount: '1200', currency: null, participants: null });
    expect(parseQuickEntry('1200 午餐')).toEqual({ title: '午餐', amount: '1200', currency: null, participants: null });
    expect(parseQuickEntry('7-11 120')).toEqual({ title: '7-11', amount: '120', currency: null, participants: null });
    expect(parseQuickEntry('iPhone 15 殼 1,490')).toEqual({ title: 'iPhone 15 殼', amount: '1,490', currency: null, participants: null });
  });

  it('accepts a currency code and arithmetic', () => {
    expect(parseQuickEntry('拉麵 980 jpy')).toEqual({ title: '拉麵', amount: '980', currency: 'JPY', participants: null });
    expect(parseQuickEntry('980JPY 拉麵')).toEqual({ title: '拉麵', amount: '980', currency: 'JPY', participants: null });
    expect(parseQuickEntry('披薩 450*2')).toEqual({ title: '披薩', amount: '450*2', currency: null, participants: null });
    expect(parseQuickEntry('飲料 ５０')).toEqual({ title: '飲料', amount: '５０', currency: null, participants: null });
  });

  it('ignores chat that is not an expense', () => {
    for (const text of ['你好', '說明', '1200', '午餐 0', '午餐 abc', '午餐 100 XYZ', '午餐\n1200', '']) {
      expect(parseQuickEntry(text)).toBeNull();
    }
  });
});

describe('participants', () => {
  it('reads @names with optional fixed amounts', () => {
    expect(parseQuickEntry('午餐 1200 @小明 @小華')).toMatchObject({
      title: '午餐',
      amount: '1200',
      participants: [
        { name: '小明', amount: null },
        { name: '小華', amount: null },
      ],
    });
    expect(parseQuickEntry('午餐 1200 @小明 500 ＠我 @Mary Jane 2*100')?.participants).toEqual([
      { name: '小明', amount: '500' },
      { name: '我', amount: null },
      { name: 'Mary Jane', amount: '2*100' },
    ]);
    expect(parseQuickEntry('拉麵 980 JPY @我@小明')).toMatchObject({ currency: 'JPY', participants: [{ name: '我' }, { name: '小明' }] });
  });

  it('keeps a name ending in a digit unless a space separates the amount', () => {
    expect(parseQuickEntry('午餐 100 @Bob2')?.participants).toEqual([{ name: 'Bob2', amount: null }]);
    expect(parseQuickEntry('午餐 100 @Bob 2')?.participants).toEqual([{ name: 'Bob', amount: '2' }]);
  });

  it('rejects an empty name', () => {
    expect(parseQuickEntry('午餐 1200 @')).toBeNull();
    expect(parseQuickEntry('午餐 1200 @ 500')).toBeNull();
  });
});

describe('entryAmount', () => {
  it('evaluates and rounds to the currency', () => {
    expect(entryAmount('1,000/3', 'TWD')).toBe('333');
    expect(entryAmount('10/3', 'USD')).toBe('3.33');
    expect(entryAmount('0', 'TWD')).toBeNull();
  });
});
