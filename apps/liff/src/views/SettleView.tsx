import { formatMinor, formatMoney, SUPPORTED_CURRENCIES, type Transfer } from '@line-split/core';
import { useState } from 'react';
import { navigate, type ViewProps } from '../App';
import { Avatar, copyText, formatDate, memberLookup, Money, TopBar } from '../components';
import { settlementText } from '../lib/settle';
import { ledgerLink, shareText, trySendToChat } from '../liff';
import { PaymentInfoLines } from '../PaymentInfoLines';
import { useSettleActions } from '../useSettleActions';
import { MemberPaymentList } from './MemberPaymentList';

export function SettleView(props: ViewProps) {
  const { api, data, reload, notify } = props;
  const { view, summary, settlements, expenses } = data;
  const base = view.ledger.baseCurrency;
  const members = memberLookup(view.members);
  const { busy, run, markPaid: confirmPaid } = useSettleActions(props);
  const [name, setName] = useState(view.ledger.name);
  const closed = view.ledger.closedAt !== null;

  const markPaid = (t: Transfer) =>
    confirmPaid(t, `確認 ${members.name(t.from)} 已付給 ${members.name(t.to)} ${formatMoney(t.amountMinor, base)}？`);

  const shareSummary = () => {
    const text = settlementText({
      ledgerName: view.ledger.name,
      totalSpentMinor: summary.totalSpentMinor,
      transfers: summary.transfers,
      base,
      members,
      link: ledgerLink(view.ledger.id),
    });
    void run(async () => {
      const result = await shareText(text);
      if (result === 'sent') notify('已傳送到聊天室');
      else if (result === 'shared') notify('已分享');
    });
  };

  const hasActivity = expenses.length > 0 || settlements.length > 0;

  const unsettled = summary.transfers.length;

  const closeLedger = () => {
    if (unsettled > 0) return;
    if (!window.confirm(`結束「${view.ledger.name}」？\n帳本會保留為唯讀，之後可隨時開新帳本。`)) return;
    void run(async () => {
      await api.closeLedger();
      await trySendToChat(`📒 「${view.ledger.name}」已結束。\n下次要記帳時，在群組輸入「帳本」即可開新帳本。`);
      navigate({ name: 'home' });
    }, '帳本已結束');
  };

  const rename = () => {
    const trimmed = name.trim();
    if (!trimmed || trimmed === view.ledger.name) return;
    void run(() => api.patchLedger({ name: trimmed }), '已更新名稱');
  };

  return (
    <main className="page">
      <TopBar title="結算" onBack={() => navigate({ name: 'home' })} />

      <h2 className="section-title">建議轉帳</h2>
      <section className="card">
        {summary.transfers.length === 0 ? (
          <p className="empty compact">目前沒有待結清的款項 🎉</p>
        ) : (
          <ul className="list">
            {summary.transfers.map((t) => (
              <li key={`${t.from}-${t.to}`} className="transfer-row">
                <Avatar member={members.get(t.from)} size={28} />
                <span className="list-main">
                  <span>
                    {members.name(t.from)} → {members.name(t.to)}
                  </span>
                  <span className="payment-line">
                    <Money minor={t.amountMinor} currency={base} />
                    <button
                      type="button"
                      className="copy-chip"
                      onClick={async () =>
                        (await copyText(formatMinor(t.amountMinor, base))) &&
                        notify(`已複製金額 ${formatMinor(t.amountMinor, base)}`)
                      }
                    >
                      複製金額
                    </button>
                  </span>
                  {members.get(t.to)?.paymentInfo ? (
                    <PaymentInfoLines info={members.get(t.to)!.paymentInfo!} notify={notify} className="small" />
                  ) : (
                    <span className="muted small">{members.name(t.to)} 尚未提供收款資訊</span>
                  )}
                </span>
                {!closed && (
                  <button type="button" className="button small" disabled={busy} onClick={() => markPaid(t)}>
                    標記已付
                  </button>
                )}
              </li>
            ))}
          </ul>
        )}
        <button type="button" className="button primary block" disabled={busy} onClick={shareSummary}>
          發送結算到聊天室
        </button>
      </section>

      <h2 className="section-title">成員收款資訊</h2>
      <MemberPaymentList api={api} data={data} reload={reload} notify={notify} />

      <h2 className="section-title">各成員餘額</h2>
      <ul className="list card">
        {summary.balances.map((b) => (
          <li key={b.memberId} className="transfer-row">
            <Avatar member={members.get(b.memberId)} size={28} />
            <span className="list-main">{members.name(b.memberId)}</span>
            <span className="list-side">
              {b.balanceMinor === 0 ? (
                <span className="muted small">已結清</span>
              ) : (
                <>
                  <span className="muted small">{b.balanceMinor > 0 ? '應收' : '應付'}</span>
                  <Money minor={b.balanceMinor} currency={base} signed />
                </>
              )}
            </span>
          </li>
        ))}
      </ul>

      {settlements.length > 0 && (
        <>
          <h2 className="section-title">還款紀錄</h2>
          <ul className="list card">
            {settlements.map((s) => (
              <li key={s.id} className="transfer-row">
                <span className="list-main">
                  <span>
                    {members.name(s.fromMemberId)} → {members.name(s.toMemberId)}
                  </span>
                  <span className="muted small">
                    {formatDate(s.settledAt)} · <Money minor={s.amountMinor} currency={base} />
                  </span>
                </span>
                {!closed && (
                  <button
                    type="button"
                    className="link-button"
                    disabled={busy}
                    onClick={() =>
                      window.confirm('復原這筆還款紀錄？') && void run(() => api.deleteSettlement(s.id), '已復原')
                    }
                  >
                    復原
                  </button>
                )}
              </li>
            ))}
          </ul>
        </>
      )}

      {!closed && (
        <>
          <h2 className="section-title">帳本設定</h2>
          <section className="card form">
            <label className="field">
              <span>帳本名稱</span>
              <span className="inline-form">
                <input value={name} onChange={(e) => setName(e.target.value)} maxLength={50} />
                <button
                  type="button"
                  className="button small"
                  disabled={busy || !name.trim() || name.trim() === view.ledger.name}
                  onClick={rename}
                >
                  儲存
                </button>
              </span>
            </label>
            <label className="field">
              <span>主幣別（結算用）</span>
              <select
                value={base}
                disabled={hasActivity || busy}
                onChange={(e) => void run(() => api.patchLedger({ baseCurrency: e.target.value }), '已更新主幣別')}
              >
                {SUPPORTED_CURRENCIES.map((c) => (
                  <option key={c} value={c}>
                    {c}
                  </option>
                ))}
              </select>
              {hasActivity && <small className="muted">已有支出或還款紀錄，主幣別無法更改。</small>}
            </label>
          </section>

          <h2 className="section-title">結束帳本</h2>
          <section className="card form">
            <p className="muted small">
              旅程或活動結束後可以結束帳本，帳本會保留為唯讀，可從首頁右上角「☰」查看。等確定下一次的主題再開新帳本，成員會自動帶入。
            </p>
            <button
              type="button"
              className="button danger block"
              disabled={busy || unsettled > 0}
              onClick={closeLedger}
            >
              結束這本帳本
            </button>
            {unsettled > 0 && (
              <small className="muted">
                還有 {unsettled} 筆款項未結清。請在上方「建議轉帳」全部標記已付後，才能結束帳本。
              </small>
            )}
          </section>
        </>
      )}
    </main>
  );
}
