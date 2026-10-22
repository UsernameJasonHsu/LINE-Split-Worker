import { describe, expect, it } from 'vitest';
import type { Member } from '../src/api';
import { memberLookup } from '../src/components';
import { myTransfers, reminderText, settlementText } from '../src/lib/settle';

const member = (id: string, displayName: string, paymentInfo: string | null = null): Member => ({
  id,
  displayName,
  avatarUrl: null,
  isVirtual: false,
  paymentInfo,
  hasLeft: false,
});

const members = memberLookup([member('a', '小明', '國泰 013-1234'), member('b', '小華'), member('c', '阿美')]);
const transfers = [
  { from: 'b', to: 'a', amountMinor: 350 },
  { from: 'c', to: 'a', amountMinor: 120 },
  { from: 'c', to: 'b', amountMinor: 80 },
];

describe('myTransfers', () => {
  it('splits what I pay from what I am owed', () => {
    expect(myTransfers(transfers, 'b')).toEqual({ owe: [transfers[0]], owed: [transfers[2]] });
    expect(myTransfers(transfers, 'x')).toEqual({ owe: [], owed: [] });
  });
});

describe('settlementText', () => {
  it('lists every transfer and each payee with payment info once', () => {
    const text = settlementText({
      ledgerName: '花蓮',
      totalSpentMinor: 1000,
      transfers,
      base: 'TWD',
      members,
      link: 'https://x',
    });
    expect(text).toContain('📒 花蓮 結算');
    expect(text).toContain('・小華 → 小明');
    expect(text.match(/小明：國泰 013-1234/g)).toHaveLength(1);
    expect(text).not.toContain('小華：');
    expect(text.endsWith('查看明細：https://x')).toBe(true);
  });

  it('celebrates when nothing is owed', () => {
    const text = settlementText({ ledgerName: '花蓮', totalSpentMinor: 0, transfers: [], base: 'TWD', members, link: 'l' });
    expect(text).toContain('目前沒有待結清的款項 🎉');
    expect(text).not.toContain('收款資訊');
  });
});

describe('reminderText', () => {
  it('names both people, the amount and how to pay', () => {
    const text = reminderText({ ledgerName: '花蓮', transfer: transfers[0]!, base: 'TWD', members, link: 'https://x' });
    expect(text.split('\n')[0]).toMatch(/^💸 小華，「花蓮」還有一筆要付給 小明：.*350/);
    expect(text).toContain('小明：國泰 013-1234');
    expect(text).toContain('https://x');
  });

  it('skips payment info the payee has not given', () => {
    const text = reminderText({ ledgerName: '花蓮', transfer: transfers[2]!, base: 'TWD', members, link: 'l' });
    expect(text).not.toContain('收款資訊');
  });
});
