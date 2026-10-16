import { useState } from 'react';
import { errorMessage } from '../api';
import type { ViewProps } from '../App';
import { ledgerLink, openLedger, trySendToChat } from '../liff';

/** Shown on a closed ledger when the group has no open one yet. */
export function StartNextLedger({ api, notify }: ViewProps) {
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);

  async function start() {
    const trimmed = name.trim();
    if (!trimmed) return;
    setBusy(true);
    try {
      const next = await api.startNextLedger(trimmed);
      await trySendToChat(`📒 開始新帳本「${trimmed}」\n${ledgerLink(next.ledger.id)}`);
      openLedger(next.ledger.id);
    } catch (err) {
      notify(errorMessage(err));
      setBusy(false);
    }
  }

  return (
    <div className="start-next">
      <p className="small">群組目前沒有進行中的帳本。要記下一次的帳時，取個名字開新帳本（成員會自動帶入）：</p>
      <span className="inline-form">
        <input value={name} onChange={(e) => setName(e.target.value)} placeholder="例如：韓國行" maxLength={50} />
        <button type="button" className="button primary small" disabled={busy || !name.trim()} onClick={start}>
          開新帳本
        </button>
      </span>
    </div>
  );
}
