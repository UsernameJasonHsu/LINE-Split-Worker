import liff from '@line/liff';

export { liff };

/** Initialises LIFF; outside the LINE app this redirects to LINE Login first. */
export async function initLiff(): Promise<void> {
  await liff.init({ liffId: import.meta.env.VITE_LIFF_ID });
  if (!liff.isLoggedIn()) {
    liff.login({ redirectUri: window.location.href });
    await new Promise(() => {}); // navigation in progress
  }
}

/**
 * Reads a query parameter. On first launch via liff.line.me the query is
 * still wrapped in `liff.state` until the SDK's secondary redirect, so look there too.
 */
export function urlParam(name: string, search = window.location.search): string | null {
  const params = new URLSearchParams(search);
  const direct = params.get(name);
  if (direct) return direct;
  const state = params.get('liff.state');
  if (!state) return null;
  const query = state.includes('?') ? state.slice(state.indexOf('?')) : state;
  return new URLSearchParams(query).get(name);
}

export const ledgerIdFromUrl = (search?: string) => urlParam('l', search);

export function ledgerLink(ledgerId: string): string {
  return `https://liff.line.me/${import.meta.env.VITE_LIFF_ID}?l=${encodeURIComponent(ledgerId)}`;
}

/** Reloads the app on another ledger (each ledger is its own ?l= URL). */
export function openLedger(ledgerId: string): void {
  window.location.assign(`${window.location.pathname}?l=${encodeURIComponent(ledgerId)}`);
}

/** Whether the LIFF was opened from a chat it can post into. */
export function canSendToChat(): boolean {
  const context = liff.getContext();
  return !!context && ['group', 'room', 'utou'].includes(context.type);
}

/** Posts into the chat the LIFF was opened from; silently does nothing elsewhere. */
export async function trySendToChat(text: string): Promise<boolean> {
  if (!canSendToChat()) return false;
  try {
    await liff.sendMessages([{ type: 'text', text }]);
    return true;
  } catch {
    return false;
  }
}

/**
 * Posts a text message: straight into the chat the LIFF was opened from when
 * possible, otherwise via the share target picker.
 */
export async function shareText(text: string): Promise<'sent' | 'shared' | 'cancelled'> {
  const message = { type: 'text' as const, text };
  const context = liff.getContext();
  if (context && ['group', 'room', 'utou'].includes(context.type)) {
    try {
      await liff.sendMessages([message]);
      return 'sent';
    } catch {
      // Missing chat_message.write scope or unsupported client: fall back to picker.
    }
  }
  if (liff.isApiAvailable('shareTargetPicker')) {
    const result = await liff.shareTargetPicker([message]);
    return result ? 'shared' : 'cancelled';
  }
  throw new Error('此環境無法傳送訊息，請在 LINE App 中開啟');
}
