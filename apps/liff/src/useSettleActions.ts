import { formatMinor, type Transfer } from '@line-split/core';
import { useState } from 'react';
import { ApiError, errorMessage } from './api';
import type { ViewProps } from './App';

/** Runs ledger changes with a shared busy flag, reloading and reporting the result. */
export function useSettleActions({ api, data, reload, notify }: ViewProps) {
  const [busy, setBusy] = useState(false);

  async function run(action: () => Promise<unknown>, done?: string) {
    setBusy(true);
    try {
      await action();
      await reload();
      if (done) notify(done);
    } catch (err) {
      notify(err instanceof Error && !('status' in err) ? err.message : errorMessage(err));
      // Someone else changed the ledger meanwhile; show the current state.
      if (err instanceof ApiError && err.status === 409) void reload();
    } finally {
      setBusy(false);
    }
  }

  /** Records the transfer as paid after the user confirms `question`. */
  const markPaid = (t: Transfer, question: string) => {
    if (!window.confirm(question)) return;
    const base = data.view.ledger.baseCurrency;
    void run(
      () => api.createSettlement({ fromMemberId: t.from, toMemberId: t.to, amount: formatMinor(t.amountMinor, base) }),
      '已記錄還款',
    );
  };

  return { busy, run, markPaid };
}
