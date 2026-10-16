import { formatMoney } from '@line-split/core';
import { navigate, type ViewProps } from '../App';
import { Avatar, memberLookup, TopBar } from '../components';
import { categoryMeta } from '../lib/categories';
import { computeStats } from '../lib/stats';

const percent = (ratio: number) => `${Math.round(ratio * 100)}%`;

/** One labelled horizontal bar; width is relative to the largest row. */
function BarRow({
  label,
  value,
  detail,
  fraction,
  leading,
}: {
  label: string;
  value: string;
  detail?: string;
  fraction: number;
  leading?: React.ReactNode;
}) {
  return (
    <li className="bar-row">
      <div className="bar-head">
        <span className="bar-label">
          {leading}
          {label}
        </span>
        <span className="bar-value">
          {value}
          {detail && <span className="muted small"> {detail}</span>}
        </span>
      </div>
      <div className="bar-track" aria-hidden>
        <div className="bar-fill" style={{ width: `${Math.max(fraction * 100, 1)}%` }} />
      </div>
    </li>
  );
}

export function StatsView({ data }: ViewProps) {
  const { view, expenses } = data;
  const base = view.ledger.baseCurrency;
  const members = memberLookup(view.members);
  const stats = computeStats(expenses, view.members);
  const maxCategory = stats.byCategory[0]?.totalMinor ?? 0;
  const maxSpent = Math.max(0, ...stats.byMember.map((m) => m.spentMinor));

  return (
    <main className="page">
      <TopBar title="統計" onBack={() => navigate({ name: 'home' })} />

      <section className="card stats-hero">
        <p className="muted small">總支出（{base}）</p>
        <p className="hero-number">{formatMoney(stats.totalMinor, base)}</p>
        <p className="muted small">
          共 {expenses.length} 筆 · {view.members.length} 位成員
          {view.members.length > 0 &&
            ` · 平均每人 ${formatMoney(Math.round(stats.totalMinor / view.members.length), base)}`}
        </p>
      </section>

      {expenses.length === 0 ? (
        <p className="empty">還沒有支出可以統計。</p>
      ) : (
        <>
          <h2 className="section-title">各分類花費</h2>
          <section className="card">
            <ul className="list bar-list">
              {stats.byCategory.map((c) => {
                const meta = categoryMeta(c.category);
                return (
                  <BarRow
                    key={c.category ?? 'none'}
                    leading={<span aria-hidden>{meta.emoji} </span>}
                    label={`${meta.label}（${c.count} 筆）`}
                    value={formatMoney(c.totalMinor, base)}
                    detail={percent(c.ratio)}
                    fraction={maxCategory ? c.totalMinor / maxCategory : 0}
                  />
                );
              })}
            </ul>
          </section>

          <h2 className="section-title">每人花費與代墊</h2>
          <section className="card">
            <ul className="list bar-list">
              {stats.byMember.map((m) => (
                <BarRow
                  key={m.memberId}
                  leading={<Avatar member={members.get(m.memberId)} size={22} />}
                  label={members.name(m.memberId)}
                  value={formatMoney(m.spentMinor, base)}
                  detail={`代墊 ${formatMoney(m.paidMinor, base)}`}
                  fraction={maxSpent ? m.spentMinor / maxSpent : 0}
                />
              ))}
            </ul>
            <p className="muted small hint">「花費」是自己分攤到的金額；「代墊」是先幫大家付出去的金額。</p>
          </section>
        </>
      )}
    </main>
  );
}
