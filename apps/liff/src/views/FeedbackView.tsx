import { useCallback, useEffect, useState } from 'react';
import { errorMessage, type AccountApi, type Feedback, type FeedbackCategory } from '../api';
import { formatDate, TopBar } from '../components';
import { CATEGORY_LABELS, CATEGORY_PLACEHOLDERS, STATUS_LABELS } from '../lib/feedback';
import { liff } from '../liff';

const MAX_LENGTH = 1000;

export function FeedbackView({
  account,
  ledgerId,
  notify,
  onBack,
}: {
  account: AccountApi;
  ledgerId?: string;
  notify: (message: string) => void;
  onBack?: () => void;
}) {
  const [category, setCategory] = useState<FeedbackCategory>('bug');
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);
  const [mine, setMine] = useState<Feedback[] | null>(null);

  const loadMine = useCallback(
    () =>
      account
        .myFeedback()
        .then(setMine)
        .catch((err) => notify(errorMessage(err))),
    [account, notify],
  );

  useEffect(() => {
    void loadMine();
  }, [loadMine]);

  async function submit() {
    const text = message.trim();
    if (!text) return;
    setBusy(true);
    try {
      await account.sendFeedback({
        category,
        message: text,
        ledgerId,
        context: { os: liff.getOS() ?? 'unknown', ua: navigator.userAgent.slice(0, 300) },
      });
      setMessage('');
      notify('已送出，感謝你的回饋！');
      await loadMine();
    } catch (err) {
      notify(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="page">
      <TopBar title="意見回饋" onBack={onBack} />

      <section className="card form">
        <div className="segmented" role="tablist">
          {(Object.keys(CATEGORY_LABELS) as FeedbackCategory[]).map((c) => (
            <button
              key={c}
              type="button"
              role="tab"
              aria-selected={category === c}
              className={category === c ? 'active' : ''}
              onClick={() => setCategory(c)}
            >
              {CATEGORY_LABELS[c]}
            </button>
          ))}
        </div>
        <textarea
          value={message}
          onChange={(e) => setMessage(e.target.value)}
          placeholder={CATEGORY_PLACEHOLDERS[category]}
          maxLength={MAX_LENGTH}
          rows={6}
        />
        <small className="muted counter">
          {message.length} / {MAX_LENGTH}
        </small>
        <button type="button" className="button primary block" disabled={busy || !message.trim()} onClick={submit}>
          {busy ? '送出中…' : '送出'}
        </button>
        <small className="muted">開發者會看到你的 LINE 名稱與回饋內容，處理進度會顯示在下方。</small>
      </section>

      <h2 className="section-title">我送出的回饋</h2>
      {mine === null ? (
        <p className="empty compact">載入中…</p>
      ) : mine.length === 0 ? (
        <p className="empty compact">還沒有送出過回饋。</p>
      ) : (
        <ul className="list">
          {mine.map((f) => (
            <li key={f.id} className="card feedback-card">
              <div className="feedback-meta">
                <span className="tag">{CATEGORY_LABELS[f.category]}</span>
                <span className={`tag status-${f.status}`}>{STATUS_LABELS[f.status]}</span>
                <span className="muted small">{formatDate(f.createdAt)}</span>
              </div>
              <p className="feedback-message">{f.message}</p>
              {f.adminNote && (
                <p className="feedback-reply">
                  <strong>開發者回覆：</strong>
                  {f.adminNote}
                </p>
              )}
            </li>
          ))}
        </ul>
      )}
    </main>
  );
}
