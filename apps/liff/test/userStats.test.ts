import { describe, expect, it } from 'vitest';
import type { UserStat } from '../src/api';
import { formatLastActive, sortUsers, userKpis } from '../src/lib/userStats';

const DAY = 24 * 60 * 60 * 1000;
const NOW = Date.UTC(2026, 9, 22, 4);

const user = (id: string, patch: Partial<UserStat> = {}): UserStat => ({
  lineUserId: id,
  displayName: id,
  avatarUrl: null,
  ledgers: 0,
  openLedgers: 0,
  expenses: 0,
  sentenceExpenses: 0,
  actions: 0,
  feedback: 0,
  opens: 0,
  activeDays: 0,
  firstSeenAt: null,
  lastActiveAt: null,
  ...patch,
});

describe('sortUsers', () => {
  const users = [
    user('a', { opens: 5, lastActiveAt: NOW - 10 * DAY }),
    user('b', { opens: 5, lastActiveAt: NOW - DAY }),
    user('c', { opens: 9 }),
  ];

  it('puts the highest first and breaks ties by recency', () => {
    expect(sortUsers(users, 'opens').map((u) => u.lineUserId)).toEqual(['c', 'b', 'a']);
  });

  it('puts never-active users last when sorting by recency', () => {
    expect(sortUsers(users, 'recent').map((u) => u.lineUserId)).toEqual(['b', 'a', 'c']);
  });
});

describe('userKpis', () => {
  it('summarises activity and expense habits', () => {
    const kpis = userKpis(
      [
        user('a', { expenses: 3, sentenceExpenses: 1, lastActiveAt: NOW - 2 * DAY }),
        user('b', { expenses: 1, sentenceExpenses: 1, lastActiveAt: NOW - 20 * DAY }),
        user('c', { lastActiveAt: NOW - 40 * DAY }),
        user('d'),
      ],
      NOW,
    );
    expect(kpis).toEqual({
      users: 4,
      active7d: 1,
      active30d: 2,
      recording: 2,
      expensesPerRecordingUser: 2,
      sentenceShare: 0.5,
    });
  });

  it('handles no users', () => {
    expect(userKpis([], NOW)).toMatchObject({ users: 0, expensesPerRecordingUser: 0, sentenceShare: 0 });
  });
});

describe('formatLastActive', () => {
  it('is relative for the last month', () => {
    expect(formatLastActive(null, NOW)).toBe('從未');
    expect(formatLastActive(NOW - 1000, NOW)).toBe('今天');
    expect(formatLastActive(NOW - 3 * DAY, NOW)).toBe('3 天前');
    expect(formatLastActive(Date.UTC(2026, 6, 1, 4), NOW)).toBe('2026/7/1');
  });
});
