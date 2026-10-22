import { formatMoney } from '@line-split/core';
import type { ReactNode } from 'react';
import type { Member } from './api';

export function Avatar({
  member,
  size = 32,
}: {
  member: Pick<Member, 'displayName' | 'avatarUrl'> | undefined;
  size?: number;
}) {
  const style = { width: size, height: size, fontSize: size * 0.42 };
  if (member?.avatarUrl) return <img className="avatar" src={member.avatarUrl} alt="" style={style} />;
  return (
    <span className="avatar avatar-fallback" style={style} aria-hidden>
      {member?.displayName.slice(0, 1) ?? '?'}
    </span>
  );
}

export function Money({ minor, currency, signed = false }: { minor: number; currency: string; signed?: boolean }) {
  const tone = !signed || minor === 0 ? '' : minor > 0 ? 'positive' : 'negative';
  return <span className={`money ${tone}`}>{formatMoney(signed ? Math.abs(minor) : minor, currency)}</span>;
}

export function TopBar({ title, onBack, action }: { title: string; onBack?: () => void; action?: ReactNode }) {
  return (
    <header className="topbar">
      {onBack ? (
        <button type="button" className="icon-button" onClick={onBack} aria-label="返回">
          ‹
        </button>
      ) : (
        <span className="icon-button-spacer" />
      )}
      <h1>{title}</h1>
      {action ?? <span className="icon-button-spacer" />}
    </header>
  );
}

/** Copies to the clipboard, falling back to a prompt where in-app browsers block it. */
export async function copyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    window.prompt('請長按複製', text);
    return false;
  }
}

export const formatDate = (ts: number) =>
  new Date(ts).toLocaleDateString('zh-TW', { month: 'numeric', day: 'numeric', weekday: 'short' });

export function memberLookup(members: Member[]) {
  const byId = new Map(members.map((m) => [m.id, m]));
  return {
    get: (id: string) => byId.get(id),
    name: (id: string) => byId.get(id)?.displayName ?? '（已離開）',
  };
}
