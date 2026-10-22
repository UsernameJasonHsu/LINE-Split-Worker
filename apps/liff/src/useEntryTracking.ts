import { useEffect, useRef } from 'react';
import type { Api, EntrySource } from './api';
import { EntryTracker } from './lib/entryTracking';

/**
 * Usage stats for the new-expense form: from the form showing to saving it,
 * how long it took and how many taps. Leaving without saving (going back or
 * closing the LIFF) is reported as abandoned. Returns `saved`, to call once
 * the expense is stored. Off for editing an expense or a read-only ledger.
 */
export function useEntryTracking(api: Api, enabled: boolean, currentSource: () => EntrySource) {
  const tracker = useRef<EntryTracker | null>(null);
  // Read at the moment of leaving, so it reflects the last state of the form.
  const sourceRef = useRef(currentSource);
  sourceRef.current = currentSource;

  useEffect(() => {
    if (!enabled) return;
    const t = new EntryTracker((s) => void api.logEntrySession(s).catch(() => {}), performance.now());
    tracker.current = t;
    const onTap = () => t.tap();
    const onHide = () => t.finish('abandoned', sourceRef.current(), performance.now());
    document.addEventListener('pointerdown', onTap, true);
    window.addEventListener('pagehide', onHide);
    return () => {
      document.removeEventListener('pointerdown', onTap, true);
      window.removeEventListener('pagehide', onHide);
      t.finish('abandoned', sourceRef.current(), performance.now());
    };
  }, [api, enabled]);

  return {
    saved: (source: EntrySource) => tracker.current?.finish('saved', source, performance.now()),
  };
}
