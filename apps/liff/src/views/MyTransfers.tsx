import { formatMoney } from '@line-split/core';
import type { ViewProps } from '../App';
import { Avatar, memberLookup, Money } from '../components';
import { myTransfers, reminderText } from '../lib/settle';
import { ledgerLink, shareText } from '../liff';
import { PaymentInfoLines } from '../PaymentInfoLines';
import { useSettleActions } from '../useSettleActions';

/** On the home balance card: whom I pay and who pays me, with the next step for each. */
export function MyTransfers(props: ViewProps) {
  const { data, notify } = props;
  const { view, summary } = data;
  const base = view.ledger.baseCurrency;
  const members = memberLookup(view.members);
  const { owe, owed } = myTransfers(summary.transfers, view.meMemberId);
  const { busy, run, markPaid } = useSettleActions(props);

  if (owe.length === 0 && owed.length === 0) return null;

  return (
    <ul className="my-transfers">
      {owe.map((t) => {
        const payee = members.get(t.to);
        return (
          <li key={`${t.from}-${t.to}`} className="my-transfer">
            <Avatar member={payee} size={32} />
            <span className="list-main">
              <span>
                付給 <strong>{members.name(t.to)}</strong> <Money minor={t.amountMinor} currency={base} />
              </span>
              {payee?.paymentInfo ? (
                <PaymentInfoLines info={payee.paymentInfo} notify={notify} className="small" />
              ) : (
                <span className="muted small">{members.name(t.to)} 尚未提供收款資訊</span>
              )}
            </span>
            <button
              type="button"
              className="button small primary"
              disabled={busy}
              onClick={() =>
                markPaid(t, `確認你已付給 ${members.name(t.to)} ${formatMoney(t.amountMinor, base)}？`)
              }
            >
              我已付款
            </button>
          </li>
        );
      })}
      {owed.map((t) => (
        <li key={`${t.from}-${t.to}`} className="my-transfer">
          <Avatar member={members.get(t.from)} size={32} />
          <span className="list-main">
            <span>
              <strong>{members.name(t.from)}</strong> 要付你 <Money minor={t.amountMinor} currency={base} />
            </span>
            <button
              type="button"
              className="link-button small"
              disabled={busy}
              onClick={() =>
                markPaid(t, `確認已收到 ${members.name(t.from)} 付的 ${formatMoney(t.amountMinor, base)}？`)
              }
            >
              已收到
            </button>
          </span>
          <button
            type="button"
            className="button small"
            disabled={busy}
            onClick={() =>
              void run(async () => {
                const text = reminderText({ ledgerName: view.ledger.name, transfer: t, base, members, link: ledgerLink(view.ledger.id) });
                const result = await shareText(text);
                if (result === 'sent') notify('已在聊天室提醒');
                else if (result === 'shared') notify('已分享提醒');
              })
            }
          >
            提醒
          </button>
        </li>
      ))}
    </ul>
  );
}
