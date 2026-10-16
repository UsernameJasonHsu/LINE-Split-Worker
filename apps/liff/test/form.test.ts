import { describe, expect, it } from 'vitest';
import type { Expense, Member } from '../src/api';
import {
  emptyForm,
  fixedRestRemainder,
  formFromExpense,
  fromDateInput,
  toDateInput,
  toPayload,
  validate,
} from '../src/lib/form';

const members: Member[] = [
  { id: 'a', displayName: 'Alice', avatarUrl: null, isVirtual: false, paymentInfo: null },
  { id: 'b', displayName: 'Bob', avatarUrl: null, isVirtual: false, paymentInfo: null },
  { id: 'c', displayName: 'Cara', avatarUrl: null, isVirtual: false, paymentInfo: null },
];
const form = (patch = {}) => ({ ...emptyForm(members, 'a', 'TWD', Date.UTC(2026, 9, 16, 4)), title: '晚餐', ...patch });

describe('toPayload', () => {
  it('builds an equal split paid by one person, ignoring separators', () => {
    const body = toPayload(form({ amount: '1,200', equalIds: ['c', 'a'] }), 'TWD', members);
    expect(body).toMatchObject({
      title: '晚餐',
      currency: 'TWD',
      amount: '1200',
      payers: [{ memberId: 'a', amount: '1200' }],
      split: { type: 'equal', memberIds: ['a', 'c'] }, // member order, not click order
    });
    expect(body).not.toHaveProperty('fxRate');
  });

  it('sends the rate only when the user edited it', () => {
    const auto = toPayload(form({ amount: '100', currency: 'JPY', fxRate: '0.2153' }), 'TWD', members);
    expect(auto).not.toHaveProperty('fxRate');
    const manual = toPayload(form({ amount: '100', currency: 'JPY', fxRate: ' 0.21 ', fxRateEdited: true }), 'TWD', members);
    expect(manual.fxRate).toBe('0.21');
  });

  it('drops zero weights and blank exact amounts', () => {
    expect(toPayload(form({ amount: '9', splitType: 'weights', weights: { a: 2, b: 0, c: 1 } }), 'TWD', members).split).toEqual({
      type: 'weights',
      items: [
        { memberId: 'a', weight: 2 },
        { memberId: 'c', weight: 1 },
      ],
    });
    expect(toPayload(form({ amount: '9', splitType: 'exact', exact: { a: '9', b: '', c: '0' } }), 'TWD', members).split).toEqual({
      type: 'exact',
      items: [{ memberId: 'a', amount: '9' }],
    });
  });
});

describe('fixed amounts + rest split equally', () => {
  const fr = (fixed: Record<string, string>, restIds: string[], amount = '12000') =>
    form({ amount, splitType: 'fixed_rest', fixed, restIds });

  it('builds the payload in member order, skipping blank fixed amounts', () => {
    expect(toPayload(fr({ c: '', a: '5,000' }, ['c', 'b']), 'TWD', members).split).toEqual({
      type: 'fixed_rest',
      fixed: [{ memberId: 'a', amount: '5000' }],
      restMemberIds: ['b', 'c'],
    });
  });

  it('previews fixed + equal rest', () => {
    const v = validate(fr({ a: '5000' }, ['b', 'c']), 'TWD', members);
    expect(v.ok && v.computed.shares.map((s) => [s.memberId, s.shareMinor])).toEqual([
      ['a', 5000],
      ['b', 3500],
      ['c', 3500],
    ]);
  });

  it('explains problems', () => {
    const err = (fixed: Record<string, string>, restIds: string[]) => {
      const v = validate(fr(fixed, restIds), 'TWD', members);
      return v.ok ? null : v.error;
    };
    expect(err({ a: '13000' }, ['b'])).toBe('指定金額超出總額 TWD 1,000');
    expect(err({ a: '5000' }, [])).toBe('剩餘 TWD 7,000 請至少勾選一人平分');
    expect(err({ a: '12000' }, [])).toBeNull();
    expect(err({ a: '1.5' }, ['b'])).toBe('TWD 不能有小數');
  });

  it('reports the remainder left for equal splitting', () => {
    expect(fixedRestRemainder(fr({ a: '5000', b: '500*2' }, ['c']), members)).toBe(6000);
    expect(fixedRestRemainder(fr({}, ['c']), members)).toBe(12000);
    expect(fixedRestRemainder(fr({ a: 'oops' }, ['c']), members)).toBeNull();
    expect(fixedRestRemainder(fr({}, ['c'], ''), members)).toBeNull();
  });

  it('round-trips an expense', () => {
    const f = formFromExpense(
      {
        splitType: 'fixed_rest',
        currency: 'TWD',
        amountMinor: 12000,
        fxRate: '1',
        spentAt: 0,
        title: '飯店',
        category: null,
        payers: [{ memberId: 'a', amountMinor: 12000, baseAmountMinor: 12000 }],
        shares: [
          { memberId: 'a', splitValue: 2000, inRest: true, shareMinor: 5334, baseShareMinor: 5334 },
          { memberId: 'b', splitValue: 1000, inRest: false, shareMinor: 1000, baseShareMinor: 1000 },
          { memberId: 'c', splitValue: null, inRest: true, shareMinor: 5666, baseShareMinor: 5666 },
        ],
      } as Expense,
      members,
    );
    expect(f).toMatchObject({ splitType: 'fixed_rest', fixed: { a: '2000', b: '1000' }, restIds: ['a', 'c'] });
    expect(toPayload(f, 'TWD', members).split).toEqual({
      type: 'fixed_rest',
      fixed: [
        { memberId: 'a', amount: '2000' },
        { memberId: 'b', amount: '1000' },
      ],
      restMemberIds: ['a', 'c'],
    });
  });
});

describe('calculator and category in the payload', () => {
  it('evaluates expressions in every amount field', () => {
    const body = toPayload(
      form({
        amount: '1200+300',
        multiPayer: true,
        payerAmounts: { a: '500*2', b: '1500-1000' },
        splitType: 'exact',
        exact: { a: '1500/2', c: '(500+250)' },
      }),
      'TWD',
      members,
    );
    expect(body.amount).toBe('1500');
    expect(body.payers).toEqual([
      { memberId: 'a', amount: '1000' },
      { memberId: 'b', amount: '500' },
    ]);
    expect(body.split).toEqual({
      type: 'exact',
      items: [
        { memberId: 'a', amount: '750' },
        { memberId: 'c', amount: '750' },
      ],
    });
    expect(validate(form({ amount: '1200+300', equalIds: ['a'] }), 'TWD', members).ok).toBe(true);
    expect(validate(form({ amount: '5/0' }), 'TWD', members)).toMatchObject({ ok: false, error: '請輸入有效金額' });
  });

  it('sends the category (null when none)', () => {
    expect(toPayload(form({ amount: '1', category: 'food' }), 'TWD', members).category).toBe('food');
    expect(toPayload(form({ amount: '1' }), 'TWD', members).category).toBeNull();
  });
});

describe('validate', () => {
  it('previews an equal split in base currency', () => {
    const v = validate(form({ amount: '3000', currency: 'JPY', fxRate: '0.2153', equalIds: ['a', 'b'] }), 'TWD', members);
    expect(v.ok && v.computed.shares.map((s) => s.baseShareMinor)).toEqual([323, 323]);
  });

  it('explains what is wrong', () => {
    const err = (patch: object) => {
      const v = validate(form(patch), 'TWD', members);
      return v.ok ? null : v.error;
    };
    expect(err({ amount: '' })).toBe('請輸入金額');
    expect(err({ amount: 'abc' })).toBe('請輸入有效金額');
    expect(err({ amount: '0' })).toBe('金額必須大於 0');
    expect(err({ amount: '10.5' })).toBe('TWD 不能有小數');
    expect(err({ amount: '10.555', currency: 'USD', fxRate: '32' })).toBe('USD 最多 2 位小數');
    expect(err({ amount: '10', currency: 'USD', fxRate: '' })).toBe('請輸入有效匯率');
    expect(err({ amount: '10', equalIds: [] })).toBe('請至少選擇一位分攤成員');
    expect(err({ amount: '10', splitType: 'weights', weights: { a: 0, b: 0, c: 0 } })).toBe('請至少選擇一位分攤成員');
    expect(err({ amount: '100', splitType: 'exact', exact: { a: '30', b: '50' } })).toBe('還有 TWD 20 未分配');
    expect(err({ amount: '100', splitType: 'exact', exact: { a: '80', b: '50' } })).toBe('超出總額 TWD 30');
  });
});

describe('multiple payers', () => {
  const multi = (payerAmounts: Record<string, string>, amount = '9000') =>
    form({ amount, multiPayer: true, payerAmounts, equalIds: ['a', 'b', 'c'] });

  it('sends each non-empty payer amount in member order', () => {
    expect(toPayload(multi({ c: '3,000', a: '6000', b: '' }), 'TWD', members).payers).toEqual([
      { memberId: 'a', amount: '6000' },
      { memberId: 'c', amount: '3000' },
    ]);
  });

  it('previews the computed payers', () => {
    const v = validate(multi({ a: '6000', b: '3000' }), 'TWD', members);
    expect(v.ok && v.computed.payers.map((p) => [p.memberId, p.amountMinor])).toEqual([
      ['a', 6000],
      ['b', 3000],
    ]);
  });

  it('explains payer totals that do not match', () => {
    const err = (payerAmounts: Record<string, string>) => {
      const v = validate(multi(payerAmounts), 'TWD', members);
      return v.ok ? null : v.error;
    };
    expect(err({})).toBe('請輸入各付款人的金額');
    expect(err({ a: '6000' })).toBe('付款還差 TWD 3,000');
    expect(err({ a: '6000', b: '4000' })).toBe('付款超出總額 TWD 1,000');
    expect(err({ a: '60.5' })).toBe('TWD 不能有小數');
  });

  it('round-trips an expense with several payers', () => {
    const f = formFromExpense(
      {
        splitType: 'equal',
        currency: 'TWD',
        amountMinor: 9000,
        fxRate: '1',
        spentAt: 0,
        title: '飯店',
        payers: [
          { memberId: 'a', amountMinor: 6000, baseAmountMinor: 6000 },
          { memberId: 'b', amountMinor: 3000, baseAmountMinor: 3000 },
        ],
        shares: [{ memberId: 'a', splitValue: null, shareMinor: 9000, baseShareMinor: 9000 }],
      } as Expense,
      members,
    );
    expect(f).toMatchObject({ multiPayer: true, payerAmounts: { a: '6000', b: '3000' } });
    expect(formFromExpense({ ...({} as Expense), splitType: 'equal', currency: 'TWD', amountMinor: 1, fxRate: '1', spentAt: 0, title: 'x', payers: [{ memberId: 'b', amountMinor: 1, baseAmountMinor: 1 }], shares: [] }, members)).toMatchObject({
      multiPayer: false,
      payerId: 'b',
    });
  });
});

describe('formFromExpense', () => {
  it('round-trips an exact split expense', () => {
    const expense: Expense = {
      id: 'e1',
      title: 'Hotel',
      currency: 'USD',
      amountMinor: 10050,
      fxRate: '32.5',
      fxSource: 'AUTO',
      baseAmountMinor: 3266,
      splitType: 'exact',
      category: null,
      spentAt: fromDateInput('2026-10-15'),
      createdBy: 'a',
      createdAt: 0,
      updatedAt: 0,
      revision: 'r1',
      payers: [{ memberId: 'b', amountMinor: 10050, baseAmountMinor: 3266 }],
      shares: [
        { memberId: 'a', splitValue: 5000, shareMinor: 5000, baseShareMinor: 1625 },
        { memberId: 'b', splitValue: 5050, shareMinor: 5050, baseShareMinor: 1641 },
      ],
    };
    const f = formFromExpense(expense, members);
    expect(f).toMatchObject({ amount: '100.50', currency: 'USD', fxRate: '32.5', fxRateEdited: false, payerId: 'b', date: '2026-10-15' });
    const body = toPayload(f, 'TWD', members);
    expect(body).not.toHaveProperty('fxRate'); // server keeps the original rate
    expect(body.split).toEqual({
      type: 'exact',
      items: [
        { memberId: 'a', amount: '50.00' },
        { memberId: 'b', amount: '50.50' },
      ],
    });
  });

  it('restores weights with zero for non-participants', () => {
    const f = formFromExpense(
      {
        splitType: 'weights',
        currency: 'TWD',
        amountMinor: 300,
        fxRate: '1',
        spentAt: 0,
        title: 'x',
        payers: [{ memberId: 'a', amountMinor: 300, baseAmountMinor: 300 }],
        shares: [
          { memberId: 'a', splitValue: 2, shareMinor: 200, baseShareMinor: 200 },
          { memberId: 'c', splitValue: 1, shareMinor: 100, baseShareMinor: 100 },
        ],
      } as Expense,
      members,
    );
    expect(f.weights).toEqual({ a: 2, b: 0, c: 1 });
  });
});

describe('date helpers', () => {
  it('round-trips through local noon', () => {
    expect(toDateInput(fromDateInput('2026-01-31'))).toBe('2026-01-31');
  });
});
