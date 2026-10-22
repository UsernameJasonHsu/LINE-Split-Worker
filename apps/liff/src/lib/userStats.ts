import type { UserStat } from '../api';

const DAY_MS = 24 * 60 * 60 * 1000;

export type UserSort = 'recent' | 'opens' | 'expenses' | 'ledgers' | 'feedback';

export const SORT_LABELS: Record<UserSort, string> = {
  recent: '最近活躍',
  opens: '開啟次數',
  expenses: '記帳筆數',
  ledgers: '帳本數',
  feedback: '回饋數',
};

const sortKey: Record<UserSort, (u: UserStat) => number> = {
  recent: (u) => u.lastActiveAt ?? 0,
  opens: (u) => u.opens,
  expenses: (u) => u.expenses,
  ledgers: (u) => u.ledgers,
  feedback: (u) => u.feedback,
};

/** Highest first; ties fall back to the most recently active. */
export function sortUsers(users: UserStat[], by: UserSort): UserStat[] {
  return [...users].sort(
    (a, b) => sortKey[by](b) - sortKey[by](a) || (b.lastActiveAt ?? 0) - (a.lastActiveAt ?? 0),
  );
}

export const activeWithin = (users: UserStat[], days: number, now = Date.now()) =>
  users.filter((u) => u.lastActiveAt !== null && now - u.lastActiveAt < days * DAY_MS).length;

export interface UserKpis {
  users: number;
  active7d: number;
  active30d: number;
  /** Users who recorded at least one expense. */
  recording: number;
  expensesPerRecordingUser: number;
  /** Share of expenses entered via the one-line input. */
  sentenceShare: number;
}

export function userKpis(users: UserStat[], now = Date.now()): UserKpis {
  const recording = users.filter((u) => u.expenses > 0).length;
  const expenses = users.reduce((s, u) => s + u.expenses, 0);
  const sentence = users.reduce((s, u) => s + u.sentenceExpenses, 0);
  return {
    users: users.length,
    active7d: activeWithin(users, 7, now),
    active30d: activeWithin(users, 30, now),
    recording,
    expensesPerRecordingUser: recording ? expenses / recording : 0,
    sentenceShare: expenses ? sentence / expenses : 0,
  };
}

/** "今天", "3 天前", or a date for anything older than a month. */
export function formatLastActive(ts: number | null, now = Date.now()): string {
  if (ts === null) return '從未';
  const days = Math.floor((now - ts) / DAY_MS);
  if (days <= 0) return '今天';
  if (days < 30) return `${days} 天前`;
  const d = new Date(ts);
  return `${d.getFullYear()}/${d.getMonth() + 1}/${d.getDate()}`;
}
