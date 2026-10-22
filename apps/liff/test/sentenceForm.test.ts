import { describe, expect, it } from 'vitest';
import type { Member } from '../src/api';
import { describeParsed, parseForForm, sentencePatch, type SentenceField } from '../src/lib/sentenceForm';

const member = (id: string, displayName: string): Member => ({
  id,
  displayName,
  avatarUrl: null,
  isVirtual: false,
  paymentInfo: null,
  hasLeft: false,
});
const members = [member('me', 'Ryan'), member('ming', '小明'), member('hua', '小華'), member('amy', '阿美')];
const names: Record<string, string> = { me: '我', ming: '小明', hua: '小華', amy: '阿美' };
const parse = (text: string) => parseForForm(text, members, 'me');

describe('sentencePatch', () => {
  it('fills amount, title, payer and split from the sentence', () => {
    expect(sentencePatch(parse('小明付了晚餐一千二，我跟小華分'), new Set(), members, 'me', 'TWD')).toEqual({
      amount: '1200',
      title: '晚餐',
      currency: 'TWD',
      payerId: 'ming',
      multiPayer: false,
      splitType: 'equal',
      equalIds: ['me', 'hua'],
    });
  });

  it('falls back to defaults for what the sentence leaves out', () => {
    expect(sentencePatch(parse('晚餐'), new Set(), members, 'me', 'TWD')).toMatchObject({
      amount: '',
      payerId: 'me',
      equalIds: ['me', 'ming', 'hua', 'amy'],
    });
    expect(sentencePatch(parse('燒肉 3600 除了阿美'), new Set(), members, 'me', 'TWD').equalIds).toEqual(['me', 'ming', 'hua']);
    expect(sentencePatch(parse('拉麵 980 日幣'), new Set(), members, 'me', 'TWD').currency).toBe('JPY');
  });

  it('leaves fields edited by hand alone', () => {
    const touched = new Set<SentenceField>(['payer', 'split', 'amount']);
    expect(sentencePatch(parse('小明付了晚餐 900 我跟小華分'), touched, members, 'me', 'TWD')).toEqual({
      title: '晚餐',
      currency: 'TWD',
    });
  });
});

describe('describeParsed', () => {
  it('summarises what was understood', () => {
    expect(describeParsed(parse('小明付了晚餐一千二，我跟小華分'), (id) => names[id]!, 'TWD')).toBe(
      'TWD 1200・「晚餐」・小明付・我、小華分',
    );
    expect(describeParsed(parse('晚餐'), (id) => names[id]!, 'TWD')).toBe('「晚餐」・還沒找到金額');
  });
});
