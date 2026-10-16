import { useEffect, useState } from 'react';
import { errorMessage, type AuditEntry } from '../api';
import { navigate, type ViewProps } from '../App';
import { Avatar, formatDate, memberLookup, TopBar } from '../components';
import { describeAudit } from '../lib/audit';

const KIND_ICON: Record<AuditEntry['action'], string> = { create: '＋', update: '✎', delete: '－' };

const formatTime = (ts: number) =>
  new Date(ts).toLocaleTimeString('zh-TW', { hour: '2-digit', minute: '2-digit', hour12: false });

/** Who added, changed or removed what in this ledger, newest first. */
export function AuditView({ api, data, notify }: ViewProps) {
  const members = memberLookup(data.view.members);
  const [state, setState] = useState<{ baseCurrency: string; entries: AuditEntry[] } | null>(null);

  useEffect(() => {
    api
      .audit()
      .then(setState)
      .catch((err) => {
        notify(errorMessage(err));
        setState({ baseCurrency: data.view.ledger.baseCurrency, entries: [] });
      });
  }, [api, notify, data.view.ledger.baseCurrency]);

  const groups = new Map<string, AuditEntry[]>();
  for (const e of state?.entries ?? []) {
    const key = formatDate(e.at);
    groups.set(key, [...(groups.get(key) ?? []), e]);
  }

  return (
    <main className="page">
      <TopBar title="修改紀錄" onBack={() => navigate({ name: 'home' })} />
      {!state ? (
        <p className="empty">載入中…</p>
      ) : state.entries.length === 0 ? (
        <p className="empty">還沒有任何紀錄。</p>
      ) : (
        <>
          {[...groups].map(([date, entries]) => (
            <section key={date}>
              <h2 className="section-title">{date}</h2>
              <ul className="list card">
                {entries.map((e) => {
                  const d = describeAudit(e, members.name, state.baseCurrency);
                  return (
                    <li key={e.id} className="audit-row">
                      <span className={`audit-icon audit-${d.kind}`} aria-hidden>
                        {KIND_ICON[d.kind]}
                      </span>
                      <div className="list-main">
                        <span>
                          <strong>{d.actor}</strong> {d.summary}
                        </span>
                        {d.details.length > 0 && (
                          <ul className="audit-details">
                            {d.details.map((line) => (
                              <li key={line}>{line}</li>
                            ))}
                          </ul>
                        )}
                      </div>
                      <span className="muted small audit-time">
                        <Avatar member={e.actorMemberId ? members.get(e.actorMemberId) : undefined} size={20} />
                        {formatTime(e.at)}
                      </span>
                    </li>
                  );
                })}
              </ul>
            </section>
          ))}
          <p className="muted small hint center">顯示最近 200 筆紀錄</p>
        </>
      )}
    </main>
  );
}
