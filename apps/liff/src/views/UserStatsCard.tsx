import { useEffect, useState } from 'react';
import { errorMessage, type AccountApi, type EntrySource, type UserStats } from '../api';
import { Avatar } from '../components';
import { formatLastActive, SORT_LABELS, sortUsers, userKpis, type UserSort } from '../lib/userStats';

function Kpi({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div className="kpi">
      <span className="kpi-value">{value}</span>
      <span className="kpi-label">{label}</span>
      {hint && <span className="kpi-hint">{hint}</span>}
    </div>
  );
}

/** Daily active users as thin bars; tapping a bar shows that day's numbers. */
function DailyChart({ daily }: { daily: UserStats['daily'] }) {
  const [picked, setPicked] = useState<number | null>(null);
  const max = Math.max(1, ...daily.map((d) => d.users));
  const shown = daily[picked ?? daily.length - 1]!;
  return (
    <div className="daily-chart">
      <div className="meter-head">
        <span>每日活躍人數（近 {daily.length} 天）</span>
        <span className="muted">
          {shown.day.slice(5).replace('-', '/')}：{shown.users} 人 · 開啟 {shown.opens} 次
        </span>
      </div>
      <div className="daily-bars" role="img" aria-label={`每日活躍人數，最高 ${max} 人`} onMouseLeave={() => setPicked(null)}>
        {daily.map((d, i) => (
          <button
            key={d.day}
            type="button"
            className={`daily-bar ${picked === i ? 'picked' : ''}`}
            title={`${d.day}：${d.users} 人，開啟 ${d.opens} 次`}
            onMouseEnter={() => setPicked(i)}
            onClick={() => setPicked(i)}
          >
            <span style={{ height: `${(d.users / max) * 100}%` }} />
          </button>
        ))}
      </div>
      <div className="daily-axis muted small">
        <span>{daily[0]!.day.slice(5).replace('-', '/')}</span>
        <span>今天</span>
      </div>
    </div>
  );
}

const ENTRY_LABELS: Record<EntrySource, string> = { form: '表單', sentence: '一句話' };

/** How fast new expenses get recorded, per entry mode, over the last 30 days. */
function EntryFlow({ entry }: { entry: UserStats['entry'] }) {
  const sources = Object.keys(ENTRY_LABELS) as EntrySource[];
  return (
    <div className="entry-flow">
      <div className="meter-head">
        <span>記帳流程（近 30 天）</span>
        <span className="muted small">從打開表單到存好</span>
      </div>
      <table className="entry-table small">
        <thead>
          <tr>
            <th scope="col">方式</th>
            <th scope="col">存好</th>
            <th scope="col">放棄率</th>
            <th scope="col">秒數</th>
            <th scope="col">點擊</th>
          </tr>
        </thead>
        <tbody>
          {sources.map((s) => {
            const e = entry[s];
            const total = e.saved + e.abandoned;
            return (
              <tr key={s}>
                <th scope="row">{ENTRY_LABELS[s]}</th>
                <td>{e.saved}</td>
                <td>{total ? `${Math.round((e.abandoned / total) * 100)}%` : '—'}</td>
                <td>{e.medianSeconds ?? '—'}</td>
                <td>{e.medianTaps ?? '—'}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
      <p className="muted small">秒數與點擊為已存好紀錄的中位數；不含修改既有支出。</p>
    </div>
  );
}

/** Admin-only per-user usage: who uses the bot, how often, and for what. */
export function UserStatsCard({ account }: { account: AccountApi }) {
  const [stats, setStats] = useState<UserStats | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [sort, setSort] = useState<UserSort>('recent');

  useEffect(() => {
    account
      .adminUsers()
      .then(setStats)
      .catch((err) => setError(errorMessage(err)));
  }, [account]);

  if (error) {
    return (
      <section className="card usage-card">
        <h2 className="usage-title">使用者統計</h2>
        <p className="error">{error}</p>
      </section>
    );
  }
  if (!stats) {
    return (
      <section className="card usage-card">
        <h2 className="usage-title">使用者統計</h2>
        <p className="muted small">載入中…</p>
      </section>
    );
  }

  const kpis = userKpis(stats.users);
  return (
    <section className="card usage-card">
      <h2 className="usage-title">使用者統計</h2>
      <div className="kpis">
        <Kpi label="使用者" value={String(kpis.users)} />
        <Kpi label="7 天活躍" value={String(kpis.active7d)} hint={`30 天 ${kpis.active30d}`} />
        <Kpi label="有記帳的人" value={String(kpis.recording)} hint={`平均 ${kpis.expensesPerRecordingUser.toFixed(1)} 筆`} />
        <Kpi label="一句話記帳" value={`${Math.round(kpis.sentenceShare * 100)}%`} />
      </div>

      <DailyChart daily={stats.daily} />
      <p className="muted small">
        {stats.trackingSince
          ? `開啟次數自 ${stats.trackingSince} 起統計；之前的活躍時間以記帳/結清操作推算。`
          : '開啟次數從這版上線後開始統計；目前活躍時間以記帳/結清操作推算。'}
      </p>

      <EntryFlow entry={stats.entry} />

      <label className="field inline-field">
        <span>排序</span>
        <select value={sort} onChange={(e) => setSort(e.target.value as UserSort)}>
          {(Object.keys(SORT_LABELS) as UserSort[]).map((k) => (
            <option key={k} value={k}>
              {SORT_LABELS[k]}
            </option>
          ))}
        </select>
      </label>

      {stats.users.length === 0 ? (
        <p className="muted small">還沒有使用者。</p>
      ) : (
        <ul className="user-stats">
          {sortUsers(stats.users, sort).map((u) => (
            <li key={u.lineUserId} className="user-stat">
              <Avatar member={u} size={36} />
              <div className="user-stat-body">
                <div className="user-stat-head">
                  <strong>{u.displayName}</strong>
                  <span className="muted small">{formatLastActive(u.lastActiveAt)}</span>
                </div>
                <div className="user-stat-nums small">
                  <span>帳本 {u.ledgers}{u.openLedgers ? `（進行中 ${u.openLedgers}）` : ''}</span>
                  <span>開啟 {u.opens} 次 / {u.activeDays} 天</span>
                  <span>記帳 {u.expenses} 筆{u.sentenceExpenses ? `（一句話 ${u.sentenceExpenses}）` : ''}</span>
                  <span>操作 {u.actions}</span>
                  <span>回饋 {u.feedback}</span>
                </div>
              </div>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
