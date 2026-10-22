import { useState } from 'react';
import { navigate, type ViewProps } from '../App';
import { Avatar, formatDate, memberLookup, Money, TopBar } from '../components';
import type { Expense } from '../api';
import { categoryMeta, CATEGORY_META, EXPENSE_CATEGORIES } from '../lib/categories';
import { DEFAULT_FILTER, filterExpenses, isFilterActive, type ExpenseFilter } from '../lib/filter';
import { openLedger } from '../liff';
import { MyTransfers } from './MyTransfers';
import { StartNextLedger } from './StartNextLedger';

// Survives navigating to an expense and back (the view remounts).
let savedFilter: ExpenseFilter = DEFAULT_FILTER;

const SCOPES: { key: ExpenseFilter['scope']; label: string }[] = [
  { key: 'all', label: '全部' },
  { key: 'mine', label: '與我有關' },
  { key: 'paidByMe', label: '我付的' },
];

export function HomeView(props: ViewProps) {
  const { data } = props;
  const { view, expenses, summary } = data;
  const base = view.ledger.baseCurrency;
  const members = memberLookup(view.members);
  const myBalance = summary.balances.find((b) => b.memberId === view.meMemberId)?.balanceMinor ?? 0;
  const { closedAt, activeLedgerId } = view.ledger;

  const [filter, setFilterState] = useState(savedFilter);
  const setFilter = (patch: Partial<ExpenseFilter>) => setFilterState((f) => (savedFilter = { ...f, ...patch }));
  const filtered = filterExpenses(expenses, filter, view.meMemberId);
  const filterActive = isFilterActive(filter);

  const groups = new Map<string, Expense[]>();
  for (const e of filtered) {
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
          {activeLedgerId ? (
            <button type="button" className="link-button" onClick={() => openLedger(activeLedgerId)}>
              前往目前的帳本 ›
            </button>
          ) : (
            <StartNextLedger {...props} />
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
          {expenses.length > 0 && (
            <>
              {' · '}
              <button type="button" className="link-button inline" onClick={() => navigate({ name: 'stats' })}>
                📊 統計
              </button>
            </>
          )}
        </p>
        {closedAt === null && <MyTransfers {...props} />}
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

      {expenses.length > 0 && (
        <section className="filter-bar" aria-label="篩選支出">
          <input
            type="search"
            value={filter.query}
            onChange={(e) => setFilter({ query: e.target.value })}
            placeholder="🔍 搜尋項目"
            aria-label="搜尋項目"
          />
          <div className="filter-row">
            <div className="chips" role="radiogroup" aria-label="範圍">
              {SCOPES.map((s) => (
                <button
                  key={s.key}
                  type="button"
                  role="radio"
                  aria-checked={filter.scope === s.key}
                  className={`chip ${filter.scope === s.key ? 'active' : ''}`}
                  onClick={() => setFilter({ scope: s.key })}
                >
                  {s.label}
                </button>
              ))}
            </div>
            <select
              className="filter-category"
              value={filter.category}
              onChange={(e) => setFilter({ category: e.target.value as ExpenseFilter['category'] })}
              aria-label="分類"
            >
              <option value="all">所有分類</option>
              {EXPENSE_CATEGORIES.map((c) => (
                <option key={c} value={c}>
                  {CATEGORY_META[c].emoji} {CATEGORY_META[c].label}
                </option>
              ))}
              <option value="none">🧾 未分類</option>
            </select>
          </div>
          {filterActive && (
            <p className="filter-summary small">
              <span>
                {filtered.length} / {expenses.length} 筆 · 合計{' '}
                <Money minor={filtered.reduce((s, e) => s + e.baseAmountMinor, 0)} currency={base} />
              </span>
              <button type="button" className="link-button small" onClick={() => setFilter(DEFAULT_FILTER)}>
                清除篩選
              </button>
            </p>
          )}
        </section>
      )}

      {expenses.length === 0 ? (
        <p className="empty">還沒有任何支出，點「新增支出」開始記帳。</p>
      ) : filtered.length === 0 ? (
        <p className="empty">沒有符合條件的支出。</p>
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
                        <span className="list-title">
                          <span aria-label={categoryMeta(e.category).label}>{categoryMeta(e.category).emoji}</span>{' '}
                          {e.title}
                        </span>
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
                        {e.note && <span className="list-note small">📝 {e.note}</span>}
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

      <footer className="page-links">
        <button type="button" className="link-button" onClick={() => navigate({ name: 'audit' })}>
          🕘 修改紀錄
        </button>
        <button type="button" className="link-button" onClick={() => navigate({ name: 'feedback' })}>
          💬 意見回饋
        </button>
        {data.isAdmin && (
          <button type="button" className="link-button" onClick={() => navigate({ name: 'admin' })}>
            🛠 回饋管理
          </button>
        )}
      </footer>
    </main>
  );
}
