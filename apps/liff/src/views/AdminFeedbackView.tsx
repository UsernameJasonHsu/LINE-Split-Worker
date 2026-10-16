import { useCallback, useEffect, useState } from 'react';
import { errorMessage, type AccountApi, type AdminFeedback, type FeedbackStatus } from '../api';
import { formatDate, TopBar } from '../components';
import { CATEGORY_LABELS, STATUS_LABELS } from '../lib/feedback';

const FILTERS: { key: FeedbackStatus | 'all'; label: string }[] = [
  { key: 'new', label: STATUS_LABELS.new },
  { key: 'in_progress', label: STATUS_LABELS.in_progress },
  { key: 'done', label: STATUS_LABELS.done },
  { key: 'wont_fix', label: STATUS_LABELS.wont_fix },
  { key: 'all', label: '全部' },
];

export function AdminFeedbackView({
  account,
  notify,
  onBack,
}: {
  account: AccountApi;
  notify: (message: string) => void;
  onBack?: () => void;
}) {
  const [filter, setFilter] = useState<FeedbackStatus | 'all'>('new');
  const [items, setItems] = useState<AdminFeedback[] | null>(null);

  const load = useCallback(() => {
    setItems(null);
    account
      .adminFeedback(filter === 'all' ? undefined : filter)
      .then(setItems)
      .catch((err) => {
        notify(errorMessage(err));
        setItems([]);
      });
  }, [account, filter, notify]);

  useEffect(load, [load]);

  return (
    <main className="page">
      <TopBar title="回饋管理" onBack={onBack} />
      <div className="chips" role="tablist">
        {FILTERS.map((f) => (
          <button
            key={f.key}
            type="button"
            role="tab"
            aria-selected={filter === f.key}
            className={`chip ${filter === f.key ? 'active' : ''}`}
            onClick={() => setFilter(f.key)}
          >
            {f.label}
          </button>
        ))}
      </div>

      {items === null ? (
        <p className="empty">載入中…</p>
      ) : items.length === 0 ? (
        <p className="empty">沒有{filter === 'all' ? '' : `「${STATUS_LABELS[filter]}」的`}回饋。</p>
      ) : (
        <ul className="list">
          {items.map((f) => (
            <AdminFeedbackCard key={f.id} item={f} account={account} notify={notify} onChanged={load} />
          ))}
        </ul>
      )}
    </main>
  );
}

function AdminFeedbackCard({
  item,
  account,
  notify,
  onChanged,
}: {
  item: AdminFeedback;
  account: AccountApi;
  notify: (message: string) => void;
  onChanged: () => void;
}) {
  const [status, setStatus] = useState(item.status);
  const [note, setNote] = useState(item.adminNote ?? '');
  const [busy, setBusy] = useState(false);
  const dirty = status !== item.status || note.trim() !== (item.adminNote ?? '');

  async function save() {
    setBusy(true);
    try {
      await account.updateFeedback(item.id, { status, adminNote: note.trim() || null });
      notify('已更新');
      onChanged();
    } catch (err) {
      notify(errorMessage(err));
      setBusy(false);
    }
  }

  return (
    <li className="card feedback-card">
      <div className="feedback-meta">
        <span className="tag">{CATEGORY_LABELS[item.category]}</span>
        <span className={`tag status-${item.status}`}>{STATUS_LABELS[item.status]}</span>
        <span className="muted small">
          {item.displayName}
          {item.ledgerName ? ` · ${item.ledgerName}` : ''} · {formatDate(item.createdAt)}
        </span>
      </div>
      <p className="feedback-message">{item.message}</p>
      {item.context?.os !== undefined && <small className="muted">裝置：{String(item.context.os)}</small>}

      <div className="form admin-controls">
        <label className="field">
          <span>狀態</span>
          <select value={status} onChange={(e) => setStatus(e.target.value as FeedbackStatus)}>
            {(Object.keys(STATUS_LABELS) as FeedbackStatus[]).map((s) => (
              <option key={s} value={s}>
                {STATUS_LABELS[s]}
              </option>
            ))}
          </select>
        </label>
        <label className="field">
          <span>回覆（回饋者看得到）</span>
          <textarea value={note} onChange={(e) => setNote(e.target.value)} maxLength={1000} rows={2} />
        </label>
        <button type="button" className="button primary small" disabled={busy || !dirty} onClick={save}>
          {busy ? '儲存中…' : '儲存'}
        </button>
      </div>
    </li>
  );
}
