import { useState } from 'react';
import { errorMessage } from '../api';
import type { ViewProps } from '../App';
import { Avatar } from '../components';
import { ledgerLink, openLedger, trySendToChat } from '../liff';

/** Shown on a closed ledger when the group has no open one yet. */
export function StartNextLedger({ api, data, notify }: ViewProps) {
  const { meMemberId } = data.view;
  // Members who left the group can't be carried over.
  const members = data.view.members.filter((m) => !m.hasLeft);
  const [name, setName] = useState('');
  const [chosen, setChosen] = useState(() => new Set(members.map((m) => m.id)));
  const [busy, setBusy] = useState(false);

  const toggle = (id: string) =>
    setChosen((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  async function start() {
    const trimmed = name.trim();
    if (!trimmed) return;
    setBusy(true);
    try {
      const next = await api.startNextLedger(trimmed, [...chosen]);
      await trySendToChat(`📒 開始新帳本「${trimmed}」\n${ledgerLink(next.ledger.id)}`);
      openLedger(next.ledger.id);
    } catch (err) {
      notify(errorMessage(err));
      setBusy(false);
    }
  }

  return (
    <div className="start-next">
      <p className="small">群組目前沒有進行中的帳本。要記下一次的帳時，取個名字開新帳本：</p>
      <input value={name} onChange={(e) => setName(e.target.value)} placeholder="例如：韓國行" maxLength={50} />
      <p className="small muted">帶入成員（沒帶入的人之後點帳本連結也能自行加入）</p>
      <ul className="list">
        {members.map((m) => (
          <li key={m.id} className="split-row">
            <label className="split-label">
              <input
                type="checkbox"
                checked={m.id === meMemberId || chosen.has(m.id)}
                disabled={m.id === meMemberId}
                onChange={() => toggle(m.id)}
              />
              <Avatar member={m} size={28} />
              <span>
                {m.displayName}
                {m.id === meMemberId ? '（我）' : ''}
              </span>
            </label>
          </li>
        ))}
      </ul>
      <button type="button" className="button primary block" disabled={busy || !name.trim()} onClick={start}>
        開新帳本
      </button>
    </div>
  );
}
