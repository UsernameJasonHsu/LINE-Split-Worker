import type { Transfer } from '@line-split/core';

export interface Member {
  id: string;
  displayName: string;
  avatarUrl: string | null;
  isVirtual: boolean;
}

export interface LedgerView {
  ledger: {
    id: string;
    name: string;
    baseCurrency: string;
    archived: boolean;
    closedAt: number | null;
    /** The group's current open ledger; equals `id` unless this one is closed. */
    activeLedgerId: string | null;
  };
  members: Member[];
  meMemberId: string;
}

export type SplitType = 'equal' | 'weights' | 'exact';

export interface Expense {
  id: string;
  title: string;
  currency: string;
  amountMinor: number;
  fxRate: string;
  fxSource: 'NONE' | 'AUTO' | 'MANUAL';
  baseAmountMinor: number;
  splitType: SplitType;
  category: string | null;
  spentAt: number;
  createdBy: string;
  createdAt: number;
  updatedAt: number;
  revision: string;
  payers: { memberId: string; amountMinor: number; baseAmountMinor: number }[];
  shares: { memberId: string; splitValue: number | null; shareMinor: number; baseShareMinor: number }[];
}

export interface ExpenseBody {
  title: string;
  currency: string;
  amount: string;
  fxRate?: string;
  spentAt?: number;
  payers: { memberId: string; amount: string }[];
  split:
    | { type: 'equal'; memberIds: string[] }
    | { type: 'weights'; items: { memberId: string; weight: number }[] }
    | { type: 'exact'; items: { memberId: string; amount: string }[] };
}

export interface Summary {
  baseCurrency: string;
  totalSpentMinor: number;
  balances: { memberId: string; balanceMinor: number }[];
  transfers: Transfer[];
}

export interface Settlement {
  id: string;
  fromMemberId: string;
  toMemberId: string;
  amountMinor: number;
  settledAt: number;
  createdBy: string;
}

export interface GroupLedger {
  id: string;
  name: string;
  baseCurrency: string;
  createdAt: number;
  closedAt: number | null;
  totalSpentMinor: number;
  isMember: boolean;
}

export class ApiError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

export type Api = ReturnType<typeof createApi>;

export function createApi(getIdToken: () => string | null, ledgerId: string) {
  const base = `/api/ledgers/${encodeURIComponent(ledgerId)}`;

  async function request<T>(method: string, path: string, body?: unknown): Promise<T> {
    const token = getIdToken();
    const res = await fetch(path, {
      method,
      headers: {
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
        ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    if (res.status === 204) return undefined as T;
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new ApiError(res.status, (data as { error?: string }).error ?? res.statusText);
    return data as T;
  }

  return {
    join: () => request<LedgerView>('POST', `${base}/join`),
    history: async () => (await request<{ ledgers: GroupLedger[] }>('GET', `${base}/history`)).ledgers,
    closeLedger: () => request<LedgerView>('POST', `${base}/close`),
    startNextLedger: (name: string) => request<LedgerView>('POST', `${base}/next`, { name }),
    patchLedger: (patch: { name?: string; baseCurrency?: string }) => request<LedgerView>('PATCH', base, patch),
    expenses: async () => (await request<{ expenses: Expense[] }>('GET', `${base}/expenses`)).expenses,
    createExpense: (body: ExpenseBody) => request<Expense>('POST', `${base}/expenses`, body),
    updateExpense: (id: string, body: ExpenseBody & { revision: string }) =>
      request<Expense>('PUT', `${base}/expenses/${id}`, body),
    deleteExpense: (id: string) => request<void>('DELETE', `${base}/expenses/${id}`),
    summary: () => request<Summary>('GET', `${base}/summary`),
    settlements: async () => (await request<{ settlements: Settlement[] }>('GET', `${base}/settlements`)).settlements,
    createSettlement: (body: { fromMemberId: string; toMemberId: string; amount: string }) =>
      request<Settlement>('POST', `${base}/settlements`, body),
    deleteSettlement: (id: string) => request<void>('DELETE', `${base}/settlements/${id}`),
    fx: (from: string, to: string) =>
      request<{ rate: string; source: string; date: string }>(
        'GET',
        `/api/fx?from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`,
      ),
  };
}

/** User-facing message for an error thrown by the API client. */
export function errorMessage(err: unknown): string {
  if (err instanceof ApiError) {
    if (err.status === 401) return '登入已過期，請關閉後重新開啟帳本';
    if (err.status === 403) return '你不是這個帳本的成員';
    if (err.status === 404) return '找不到資料，可能已被刪除';
    if (err.status === 409 && /closed/i.test(err.message)) return '這本帳本已結束，無法修改';
    if (err.status === 409 && /open ledger/i.test(err.message)) return '群組已有進行中的帳本，請重新整理';
    if (err.status === 409) return '資料已被其他人修改，請重新整理後再試';
    if (err.status === 502) return '暫時無法取得匯率，請手動輸入匯率';
    return err.message;
  }
  return '連線失敗，請稍後再試';
}
