import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  createAccountApi,
  createApi,
  errorMessage,
  type AccountApi,
  type Api,
  type LedgerSnapshot,
} from './api';
import { initLiff, ledgerIdFromUrl, liff, urlParam } from './liff';
import { AdminFeedbackView } from './views/AdminFeedbackView';
import { AuditView } from './views/AuditView';
import { ExpenseFormView } from './views/ExpenseFormView';
import { FeedbackView } from './views/FeedbackView';
import { HomeView } from './views/HomeView';
import { LedgersView } from './views/LedgersView';
import { SettleView } from './views/SettleView';
import { StatsView } from './views/StatsView';

export type LedgerData = LedgerSnapshot;

export type Route =
  | { name: 'home' }
  | { name: 'expense'; id: string | null }
  | { name: 'settle' }
  | { name: 'ledgers' }
  | { name: 'feedback' }
  | { name: 'stats' }
  | { name: 'audit' }
  | { name: 'admin' };

function parseHash(hash: string): Route {
  const m = hash.match(/^#\/expense\/(.+)$/);
  if (m) return { name: 'expense', id: m[1] === 'new' ? null : decodeURIComponent(m[1]!) };
  if (hash === '#/settle') return { name: 'settle' };
  if (hash === '#/ledgers') return { name: 'ledgers' };
  if (hash === '#/feedback') return { name: 'feedback' };
  if (hash === '#/stats') return { name: 'stats' };
  if (hash === '#/audit') return { name: 'audit' };
  if (hash === '#/admin') return { name: 'admin' };
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

type StandalonePage = 'feedback' | 'admin';

type Boot =
  | { status: 'loading' }
  | { status: 'error'; message: string }
  | { status: 'ready'; api: Api }
  /** Feedback / admin pages opened without a ledger (e.g. from the bot's DM). */
  | { status: 'standalone'; account: AccountApi; page: StandalonePage };

const isStandalonePage = (v: string | null): v is StandalonePage => v === 'feedback' || v === 'admin';

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
      const getToken = () => liff.getIDToken();
      const ledgerId = ledgerIdFromUrl();
      const page = urlParam('view');
      if (!ledgerId) {
        if (isStandalonePage(page)) {
          setBoot({ status: 'standalone', account: createAccountApi(getToken), page });
          return;
        }
        setBoot({ status: 'error', message: '請從群組中的「打開帳本」按鈕進入，或在群組輸入「帳本」取得連結' });
        return;
      }
      const expenseId = urlParam('e');
      if (isStandalonePage(page) || expenseId) {
        // Deep link into a page or expense of this ledger (e.g. 修改 from the
        // bot's chat); drop the extra params so a reload lands on home.
        const hash = expenseId ? `#/expense/${encodeURIComponent(expenseId)}` : `#/${page}`;
        history.replaceState(null, '', `${window.location.pathname}?l=${encodeURIComponent(ledgerId)}${hash}`);
        window.dispatchEvent(new Event(ROUTE_EVENT));
      }
      setBoot({ status: 'ready', api: createApi(getToken, ledgerId) });
    })();
  }, []);

  const api = boot.status === 'ready' ? boot.api : null;

  const reload = useCallback(async () => {
    if (!api) return;
    try {
      // The first load counts as a visit; reloads after a change don't.
      setData(await api.open({ visit: !data }));
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

  const ctx = useMemo(() => (api && data ? { api, data, reload, notify: setToast } : null), [api, data, reload]);

  const toastEl = toast && (
    <div className="toast" role="status">
      {toast}
    </div>
  );

  if (boot.status === 'error') return <FullScreenMessage title="無法開啟帳本" body={boot.message} />;
  if (boot.status === 'standalone') {
    return (
      <>
        {boot.page === 'feedback' ? (
          <FeedbackView account={boot.account} notify={setToast} />
        ) : (
          <AdminFeedbackView account={boot.account} notify={setToast} />
        )}
        {toastEl}
      </>
    );
  }
  if (!ctx) return <FullScreenMessage title="載入中…" />;
  const back = () => navigate({ name: 'home' });

  return (
    <>
      {route.name === 'home' && <HomeView {...ctx} />}
      {route.name === 'expense' && <ExpenseFormView key={route.id ?? 'new'} {...ctx} expenseId={route.id} />}
      {route.name === 'settle' && <SettleView {...ctx} />}
      {route.name === 'ledgers' && <LedgersView {...ctx} />}
      {route.name === 'stats' && <StatsView {...ctx} />}
      {route.name === 'audit' && <AuditView {...ctx} />}
      {route.name === 'feedback' && (
        <FeedbackView account={ctx.api} ledgerId={ctx.data.view.ledger.id} notify={setToast} onBack={back} />
      )}
      {route.name === 'admin' && <AdminFeedbackView account={ctx.api} notify={setToast} onBack={back} />}
      {toastEl}
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
