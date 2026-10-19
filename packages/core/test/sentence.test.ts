import { describe, expect, it } from 'vitest';
import { chineseNumber, parseSentence } from '../src/sentence';

const members = [
  { id: 'me', name: 'Ryan' },
  { id: 'ming', name: '小明' },
  { id: 'hua', name: '小華' },
  { id: 'amy', name: '阿美 Amy 🐶' },
];
const parse = (text: string) => parseSentence(text, members, 'me');

describe('chineseNumber', () => {
  it.each([
    ['三百', 300],
    ['三百五', 350],
    ['三百零五', 305],
    ['一千二', 1200],
    ['兩千五百', 2500],
    ['十二', 12],
    ['十', 10],
    ['1萬5', 15000],
    ['1.5萬', 15000],
    ['一萬零五百', 10500],
    ['一萬二千五', 12500],
    ['3千', 3000],
  ])('%s → %d', (text, value) => {
    expect(chineseNumber(text)).toBe(value);
  });

  it('rejects other characters', () => {
    expect(chineseNumber('三明治')).toBeNull();
  });
});

describe('parseSentence', () => {
  it('reads title and amount in any order', () => {
    expect(parse('晚餐 1200')).toEqual({ amount: '1200', currency: null, title: '晚餐', payerId: null, split: null });
    expect(parse('1200 晚餐')).toMatchObject({ amount: '1200', title: '晚餐' });
    expect(parse('晚餐1200元')).toMatchObject({ amount: '1200', title: '晚餐' });
    expect(parse('披薩 450*2')).toMatchObject({ amount: '450*2', title: '披薩' });
    expect(parse('燒肉 3,600')).toMatchObject({ amount: '3,600', title: '燒肉' });
  });

  it('reads Chinese numerals as dictation produces them', () => {
    expect(parse('小明付了計程車三百')).toMatchObject({ amount: '300', title: '計程車', payerId: 'ming' });
    expect(parse('咖啡一百五十塊')).toMatchObject({ amount: '150', title: '咖啡' });
    expect(parse('機票 1萬5')).toMatchObject({ amount: '15000', title: '機票' });
    expect(parse('住宿兩千五')).toMatchObject({ amount: '2500', title: '住宿' });
  });

  it('leaves numbers that are part of the title or a count alone', () => {
    expect(parse('7-11 120')).toMatchObject({ amount: '120', title: '7-11' });
    expect(parse('三明治 80')).toMatchObject({ amount: '80', title: '三明治' });
    expect(parse('十全大補湯 300')).toMatchObject({ amount: '300', title: '十全大補湯' });
    expect(parse('3人 晚餐 900')).toMatchObject({ amount: '900', title: '3人 晚餐' });
    expect(parse('晚餐')).toMatchObject({ amount: null, title: '晚餐' });
  });

  it('finds the currency', () => {
    expect(parse('拉麵 980 日幣')).toMatchObject({ amount: '980', currency: 'JPY', title: '拉麵' });
    expect(parse('拉麵980日圓')).toMatchObject({ amount: '980', currency: 'JPY', title: '拉麵' });
    expect(parse('taxi 12.5 usd')).toMatchObject({ amount: '12.5', currency: 'USD', title: 'taxi' });
  });

  it('finds who paid, with or without spaces', () => {
    expect(parse('我付了民宿 8000')).toMatchObject({ payerId: 'me', title: '民宿', amount: '8000' });
    expect(parse('晚餐小明付 900')).toMatchObject({ payerId: 'ming', title: '晚餐' });
    expect(parse('Amy 先付了午餐 500')).toMatchObject({ payerId: 'amy', title: '午餐' });
    expect(parse('阿美刷卡 門票 1200')).toMatchObject({ payerId: 'amy', title: '門票' });
  });

  it('finds who splits it', () => {
    expect(parse('咖啡 一百五 我跟小華分')).toMatchObject({
      amount: '150',
      title: '咖啡',
      split: { kind: 'only', memberIds: ['me', 'hua'] },
    });
    expect(parse('晚餐 900 小明 小華 平分')).toMatchObject({ title: '晚餐', split: { kind: 'only', memberIds: ['ming', 'hua'] } });
    expect(parse('燒肉 3600 大家分')).toMatchObject({ title: '燒肉', split: { kind: 'all' } });
    expect(parse('燒肉 3600 除了阿美')).toMatchObject({ title: '燒肉', split: { kind: 'except', memberIds: ['amy'] } });
    expect(parse('燒肉 3600 除了阿美和小明以外都分')).toMatchObject({
      title: '燒肉',
      split: { kind: 'except', memberIds: ['amy', 'ming'] },
    });
  });

  it('combines payer and split', () => {
    expect(parse('小明付了晚餐一千二，我跟小華分')).toEqual({
      amount: '1200',
      currency: null,
      title: '晚餐',
      payerId: 'ming',
      split: { kind: 'only', memberIds: ['me', 'hua'] },
    });
  });

  it('does not guess names it cannot place', () => {
    expect(parse('小美付了晚餐 900')).toMatchObject({ payerId: null, amount: '900' });
    expect(parse('和牛 2000 他們分')).toMatchObject({ split: null, amount: '2000' });
    expect(parse('付費停車 100')).toMatchObject({ payerId: null, title: '付費停車' });
  });
});
