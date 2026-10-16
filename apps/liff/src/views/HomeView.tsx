import { navigate, type ViewProps } from '../App';
import { Avatar, formatDate, memberLookup, Money, TopBar } from '../components';
import type { Expense } from '../api';
import { openLedger } from '../liff';

export function HomeView({ data }: ViewProps) {
  const { view, expenses, summary } = data;
  const base = view.ledger.baseCurrency;
  const members = memberLookup(view.members);
  const myBalance = summary.balances.find((b) => b.memberId === view.meMemberId)?.balanceMinor ?? 0;
  const { closedAt, activeLedgerId } = view.ledger;

  const groups = new Map<string, Expense[]>();
  for (const e of expenses) {
    const key = formatDate(e.spentAt);
    groups.set(key, [...(groups.get(key) ?? []), e]);
  }

  return (
    <main className="page">
      <TopBar
        title={view.ledger.name}
        action={
          <button
            type="button"
            className="icon-button text"
            onClick={() => navigate({ name: 'ledgers' })}
            aria-label="所有帳本"
          >
            ☰
          </button>
        }
      />

      {closedAt !== null ? (
        <div className="banner">
          <p>這本帳本已於 {formatDate(closedAt)} 結束，僅供查看。</p>
          {activeLedgerId && (
            <button type="button" className="link-button" onClick={() => openLedger(activeLedgerId)}>
              前往目前的帳本 ›
            </button>
          )}
        </div>
      ) : (
        view.ledger.archived && <p className="banner">Bot 已離開群組，帳本仍可查看與記帳。</p>
      )}

      <section className="card balance-card">
        <p className="muted small">我的餘額</p>
        <p className="balance-amount">
          {myBalance === 0 ? (
            <span>已結清</span>
          ) : (
            <>
              <span className="small">{myBalance > 0 ? '應收 ' : '應付 '}</span>
              <Money minor={myBalance} currency={base} signed />
            </>
          )}
        </p>
        <p className="muted small">
          總支出 <Money minor={summary.totalSpentMinor} currency={base} /> · {view.members.length} 位成員
        </p>
        {closedAt === null ? (
          <div className="button-row">
            <button type="button" className="button primary" onClick={() => navigate({ name: 'expense', id: null })}>
              ＋ 新增支出
            </button>
            <button type="button" className="button" onClick={() => navigate({ name: 'settle' })}>
              結算
            </button>
          </div>
        ) : (
          <button type="button" className="button block spaced" onClick={() => navigate({ name: 'settle' })}>
            查看結算
          </button>
        )}
      </section>

      {expenses.length === 0 ? (
        <p className="empty">還沒有任何支出，點「新增支出」開始記帳。</p>
      ) : (
        [...groups].map(([date, items]) => (
          <section key={date}>
            <h2 className="section-title">{date}</h2>
            <ul className="list card">
              {items.map((e) => {
                const payer = e.payers[0];
                const myShare = e.shares.find((s) => s.memberId === view.meMemberId);
                return (
                  <li key={e.id}>
                    <button type="button" className="list-item" onClick={() => navigate({ name: 'expense', id: e.id })}>
                      <Avatar member={payer && members.get(payer.memberId)} />
                      <span className="list-main">
                        <span className="list-title">{e.title}</span>
                        <span className="muted small">
                          {payer ? members.name(payer.memberId) : ''} 付款
                          {e.payers.length > 1 ? ` 等 ${e.payers.length} 人` : ''}
                          {myShare ? (
                            <>
                              {' · 我的份額 '}
                              <Money minor={myShare.baseShareMinor} currency={base} />
                            </>
                          ) : (
                            ' · 與我無關'
                          )}
                        </span>
                      </span>
                      <span className="list-side">
                        <Money minor={e.amountMinor} currency={e.currency} />
                        {e.currency !== base && (
                          <span className="muted small">
                            ≈ <Money minor={e.baseAmountMinor} currency={base} />
                          </span>
                        )}
                      </span>
                    </button>
                  </li>
                );
              })}
            </ul>
          </section>
        ))
      )}
    </main>
  );
}
