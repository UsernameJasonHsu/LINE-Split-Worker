import { useEffect, useState } from 'react';
import { errorMessage, type AccountApi, type Usage } from '../api';

const WARN_RATIO = 0.8;

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 ** 2) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 ** 3) return `${(bytes / 1024 ** 2).toFixed(1)} MB`;
  return `${(bytes / 1024 ** 3).toFixed(2)} GB`;
}

function Meter({ label, used, limit, text }: { label: string; used: number; limit: number; text: string }) {
  const ratio = Math.min(1, used / limit);
  const warn = ratio >= WARN_RATIO;
  return (
    <div className="meter">
      <div className="meter-head">
        <span>{label}</span>
        <span className={warn ? 'negative' : 'muted'}>
          {text}（{(ratio * 100).toFixed(ratio < 0.01 ? 2 : 0)}%）
        </span>
      </div>
      <div
        className="meter-track"
        role="progressbar"
        aria-valuenow={Math.round(ratio * 100)}
        aria-valuemin={0}
        aria-valuemax={100}
      >
        <div className={`meter-fill ${warn ? 'warn' : ''}`} style={{ width: `${Math.max(ratio * 100, 1)}%` }} />
      </div>
      {warn && <small className="negative">已超過 {WARN_RATIO * 100}%，請留意用量</small>}
    </div>
  );
}

/** Admin-only snapshot of database size, record counts and LINE push usage. */
export function UsageCard({ account }: { account: AccountApi }) {
  const [usage, setUsage] = useState<Usage | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    account
      .adminUsage()
      .then(setUsage)
      .catch((err) => setError(errorMessage(err)));
  }, [account]);

  return (
    <section className="card usage-card">
      <h2 className="usage-title">系統用量</h2>
      {error ? (
        <p className="error">{error}</p>
      ) : !usage ? (
        <p className="muted small">載入中…</p>
      ) : (
        <>
          {usage.line ? (
            usage.line.quota === null ? (
              <p className="small">LINE 推播：本月已用 {usage.line.used} 則（無上限方案）</p>
            ) : (
              <Meter
                label="LINE 推播（本月）"
                used={usage.line.used}
                limit={usage.line.quota}
                text={`${usage.line.used} / ${usage.line.quota} 則`}
              />
            )
          ) : (
            <p className="muted small">暫時無法取得 LINE 推播用量</p>
          )}

          {usage.database.sizeBytes !== null && (
            <Meter
              label="資料庫容量"
              used={usage.database.sizeBytes}
              limit={usage.database.limitBytes}
              text={`${formatBytes(usage.database.sizeBytes)} / ${formatBytes(usage.database.limitBytes)}`}
            />
          )}

          <p className="muted small">
            帳本 {usage.database.counts.ledgers} 本 · 使用者 {usage.database.counts.users} 位 · 支出{' '}
            {usage.database.counts.expenses} 筆 · 回饋 {usage.database.counts.feedback} 則
          </p>
          <p className="muted small">
            記帳方式：表單 {usage.database.expenseSources.form} · 一句話 {usage.database.expenseSources.sentence} · 私訊{' '}
            {usage.database.expenseSources.chat}
          </p>

          <div className="usage-links">
            <a href={usage.links.workers} target="_blank" rel="noreferrer">
              Worker 請求數 ›
            </a>
            <a href={usage.links.d1} target="_blank" rel="noreferrer">
              資料庫讀寫 ›
            </a>
            <a href={usage.links.lineManager} target="_blank" rel="noreferrer">
              LINE 後台 ›
            </a>
          </div>
        </>
      )}
    </section>
  );
}
