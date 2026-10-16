import { useEffect, useState } from 'react';
import { errorMessage, type GroupLedger } from '../api';
import { navigate, type ViewProps } from '../App';
import { formatDate, Money, TopBar } from '../components';
import { openLedger } from '../liff';

export function LedgersView({ api, data, notify }: ViewProps) {
  const [ledgers, setLedgers] = useState<GroupLedger[] | null>(null);
  const currentId = data.view.ledger.id;

  useEffect(() => {
    api
      .history()
      .then(setLedgers)
      .catch((err) => notify(errorMessage(err)));
  }, [api, notify]);

  return (
    <main className="page">
      <TopBar title="所有帳本" onBack={() => navigate({ name: 'home' })} />
      {!ledgers ? (
        <p className="empty">載入中…</p>
      ) : (
        <ul className="list card">
          {ledgers.map((l) => (
            <li key={l.id}>
              <button
                type="button"
                className="list-item"
                disabled={!l.isMember || l.id === currentId}
                onClick={() => openLedger(l.id)}
              >
                <span className="list-main">
                  <span className="list-title">
                    {l.name}
                    {l.id === currentId && <span className="tag">目前查看</span>}
                  </span>
                  <span className="muted small">
                    {formatDate(l.createdAt)} – {l.closedAt ? formatDate(l.closedAt) : '進行中'}
                    {!l.isMember && ' · 你未參與'}
                  </span>
                </span>
                <span className="list-side">
                  <Money minor={l.totalSpentMinor} currency={l.baseCurrency} />
                  <span className={`tag ${l.closedAt ? '' : 'tag-open'}`}>{l.closedAt ? '已結束' : '進行中'}</span>
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </main>
  );
}
