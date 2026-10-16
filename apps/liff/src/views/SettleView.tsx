import { formatMinor, formatMoney, SUPPORTED_CURRENCIES, type Transfer } from '@line-split/core';
import { useState } from 'react';
import { errorMessage } from '../api';
import { navigate, type ViewProps } from '../App';
import { Avatar, formatDate, memberLookup, Money, TopBar } from '../components';
import { ledgerLink, openLedger, shareText, trySendToChat } from '../liff';

export function SettleView({ api, data, reload, notify }: ViewProps) {
  const { view, summary, settlements, expenses } = data;
  const base = view.ledger.baseCurrency;
  const members = memberLookup(view.members);
  const [busy, setBusy] = useState(false);
  const [nextName, setNextName] = useState('');
  const closed = view.ledger.closedAt !== null;

  async function run(action: () => Promise<unknown>, done?: string) {
    setBusy(true);
    try {
      await action();
      await reload();
      if (done) notify(done);
    } catch (err) {
      notify(err instanceof Error && !('status' in err) ? err.message : errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  const markPaid = (t: Transfer) => {
    const text = `確認 ${members.name(t.from)} 已付給 ${members.name(t.to)} ${formatMoney(t.amountMinor, base)}？`;
    if (!window.confirm(text)) return;
    void run(
      () => api.createSettlement({ fromMemberId: t.from, toMemberId: t.to, amount: formatMinor(t.amountMinor, base) }),
      '已記錄還款',
    );
  };

  const shareSummary = () => {
    const lines =
      summary.transfers.length === 0
        ? ['目前沒有待結清的款項 🎉']
        : summary.transfers.map(
            (t) => `・${members.name(t.from)} → ${members.name(t.to)}  ${formatMoney(t.amountMinor, base)}`,
          );
    const text = [
      `📒 ${view.ledger.name} 結算`,
      `總支出 ${formatMoney(summary.totalSpentMinor, base)}`,
      '',
      ...lines,
      '',
      `查看明細：${ledgerLink(view.ledger.id)}`,
    ].join('\n');
    void run(async () => {
      const result = await shareText(text);
      if (result === 'sent') notify('已傳送到聊天室');
      else if (result === 'shared') notify('已分享');
    });
  };

  const hasActivity = expenses.length > 0 || settlements.length > 0;

  const closeAndStartNext = () => {
    const name = nextName.trim();
    if (!name) return;
    const pending = summary.transfers.length;
    const warning = pending
      ? `還有 ${pending} 筆款項尚未結清，結束後無法再標記已付（紀錄仍可查看）。\n\n確定結束「${view.ledger.name}」並開始「${name}」？`
      : `結束「${view.ledger.name}」並開始新帳本「${name}」？\n舊帳本會保留為唯讀。`;
    if (!window.confirm(warning)) return;
    void run(async () => {
      const next = await api.closeLedger(name);
      await trySendToChat(`📒 「${view.ledger.name}」已結束，開始新帳本「${name}」\n${ledgerLink(next.ledger.id)}`);
      openLedger(next.ledger.id);
    });
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
                  <Money minor={t.amountMinor} currency={base} />
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
              旅程或活動結束後，可以開一本新帳本給下一次使用。成員會自動帶入，這本帳本會保留為唯讀，可從首頁右上角「☰」查看。
            </p>
            <label className="field">
              <span>新帳本名稱</span>
              <input
                value={nextName}
                onChange={(e) => setNextName(e.target.value)}
                placeholder="例如：韓國行"
                maxLength={50}
              />
            </label>
            <button
              type="button"
              className="button block"
              disabled={busy || !nextName.trim()}
              onClick={closeAndStartNext}
            >
              結束這本帳本，開新帳本
            </button>
          </section>
        </>
      )}
    </main>
  );
}
