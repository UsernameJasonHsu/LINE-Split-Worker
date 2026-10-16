import { useCallback, useEffect, useMemo, useState } from 'react';
import { createApi, errorMessage, type Api, type Expense, type LedgerView, type Settlement, type Summary } from './api';
import { initLiff, ledgerIdFromUrl, liff } from './liff';
import { ExpenseFormView } from './views/ExpenseFormView';
import { HomeView } from './views/HomeView';
import { LedgersView } from './views/LedgersView';
import { SettleView } from './views/SettleView';

export interface LedgerData {
  view: LedgerView;
  expenses: Expense[];
  summary: Summary;
  settlements: Settlement[];
}

export type Route =
  | { name: 'home' }
  | { name: 'expense'; id: string | null }
  | { name: 'settle' }
  | { name: 'ledgers' };

function parseHash(hash: string): Route {
  const m = hash.match(/^#\/expense\/(.+)$/);
  if (m) return { name: 'expense', id: m[1] === 'new' ? null : decodeURIComponent(m[1]!) };
  if (hash === '#/settle') return { name: 'settle' };
  if (hash === '#/ledgers') return { name: 'ledgers' };
  return { name: 'home' };
}

const ROUTE_EVENT = 'app:route';

/**
 * Sub-pages are pushed with `{ inApp: true }` so "back to home" can pop them
 * (keeping the device back button consistent), while a page opened directly
 * by URL is replaced instead of navigating out of the LIFF app.
 */
export function navigate(route: Route) {
  if (route.name === 'home') {
    if ((history.state as { inApp?: boolean } | null)?.inApp) {
      history.back();
      return;
    }
    history.replaceState(null, '', window.location.pathname + window.location.search);
  } else {
    const hash =
      route.name === 'expense' ? `#/expense/${route.id ? encodeURIComponent(route.id) : 'new'}` : `#/${route.name}`;
    history.pushState({ inApp: true }, '', hash);
  }
  window.dispatchEvent(new Event(ROUTE_EVENT));
}

function useHashRoute(): Route {
  const [route, setRoute] = useState(() => parseHash(window.location.hash));
  useEffect(() => {
    const onChange = () => {
      setRoute(parseHash(window.location.hash));
      window.scrollTo(0, 0);
    };
    window.addEventListener('popstate', onChange);
    window.addEventListener(ROUTE_EVENT, onChange);
    return () => {
      window.removeEventListener('popstate', onChange);
      window.removeEventListener(ROUTE_EVENT, onChange);
    };
  }, []);
  return route;
}

type Boot = { status: 'loading' } | { status: 'error'; message: string } | { status: 'ready'; api: Api };

export function App() {
  const [boot, setBoot] = useState<Boot>({ status: 'loading' });
  const [data, setData] = useState<LedgerData | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const route = useHashRoute();

  useEffect(() => {
    (async () => {
      try {
        await initLiff();
      } catch {
        setBoot({ status: 'error', message: 'LINE 初始化失敗，請在 LINE App 中開啟' });
        return;
      }
      const ledgerId = ledgerIdFromUrl();
      if (!ledgerId) {
        setBoot({ status: 'error', message: '請從群組中的「打開帳本」按鈕進入，或在群組輸入「帳本」取得連結' });
        return;
      }
      setBoot({ status: 'ready', api: createApi(() => liff.getIDToken(), ledgerId) });
    })();
  }, []);

  const api = boot.status === 'ready' ? boot.api : null;

  const reload = useCallback(async () => {
    if (!api) return;
    try {
      const view = await api.join();
      const [expenses, summary, settlements] = await Promise.all([api.expenses(), api.summary(), api.settlements()]);
      setData({ view, expenses, summary, settlements });
    } catch (err) {
      if (!data) setBoot({ status: 'error', message: errorMessage(err) });
      else setToast(errorMessage(err));
    }
  }, [api, data]);

  useEffect(() => {
    if (api) void reload();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- initial load only
  }, [api]);

  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), 3500);
    return () => clearTimeout(t);
  }, [toast]);

  const ctx = useMemo(
    () => (api && data ? { api, data, reload, notify: setToast } : null),
    [api, data, reload],
  );

  if (boot.status === 'error') return <FullScreenMessage title="無法開啟帳本" body={boot.message} />;
  if (!ctx) return <FullScreenMessage title="載入中…" />;

  return (
    <>
      {route.name === 'home' && <HomeView {...ctx} />}
      {route.name === 'expense' && <ExpenseFormView key={route.id ?? 'new'} {...ctx} expenseId={route.id} />}
      {route.name === 'settle' && <SettleView {...ctx} />}
      {route.name === 'ledgers' && <LedgersView {...ctx} />}
      {toast && (
        <div className="toast" role="status">
          {toast}
        </div>
      )}
    </>
  );
}

export interface ViewProps {
  api: Api;
  data: LedgerData;
  reload: () => Promise<void>;
  notify: (message: string) => void;
}

function FullScreenMessage({ title, body }: { title: string; body?: string }) {
  return (
    <main className="center-screen">
      <h1>{title}</h1>
      {body && <p className="muted">{body}</p>}
    </main>
  );
}
