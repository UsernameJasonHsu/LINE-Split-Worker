import { formatMoney, type Transfer } from '@line-split/core';
import type { Member } from '../api';

interface MemberLookup {
  get: (id: string) => Member | undefined;
  name: (id: string) => string;
}

/** The suggested transfers that involve me: what I pay and what I'm owed. */
export function myTransfers(transfers: Transfer[], meId: string): { owe: Transfer[]; owed: Transfer[] } {
  return {
    owe: transfers.filter((t) => t.from === meId),
    owed: transfers.filter((t) => t.to === meId),
  };
}

function paymentInfoLines(memberIds: string[], members: MemberLookup): string[] {
  const payees = [...new Set(memberIds)].map((id) => members.get(id)).filter((m) => m?.paymentInfo);
  return payees.length ? ['', '收款資訊：', ...payees.map((m) => `・${m!.displayName}：${m!.paymentInfo}`)] : [];
}

/** Every suggested transfer, for posting the whole settlement into the chat. */
export function settlementText({
  ledgerName,
  totalSpentMinor,
  transfers,
  base,
  members,
  link,
}: {
  ledgerName: string;
  totalSpentMinor: number;
  transfers: Transfer[];
  base: string;
  members: MemberLookup;
  link: string;
}): string {
  const lines =
    transfers.length === 0
      ? ['目前沒有待結清的款項 🎉']
      : transfers.map((t) => `・${members.name(t.from)} → ${members.name(t.to)}  ${formatMoney(t.amountMinor, base)}`);
  return [
    `📒 ${ledgerName} 結算`,
    `總支出 ${formatMoney(totalSpentMinor, base)}`,
    '',
    ...lines,
    ...paymentInfoLines(
      transfers.map((t) => t.to),
      members,
    ),
    '',
    `查看明細：${link}`,
  ].join('\n');
}

/** A nudge for one transfer, sent by the person who is owed. */
export function reminderText({
  ledgerName,
  transfer,
  base,
  members,
  link,
}: {
  ledgerName: string;
  transfer: Transfer;
  base: string;
  members: MemberLookup;
  link: string;
}): string {
  return [
    `💸 ${members.name(transfer.from)}，「${ledgerName}」還有一筆要付給 ${members.name(transfer.to)}：${formatMoney(transfer.amountMinor, base)}`,
    ...paymentInfoLines([transfer.to], members),
    '',
    `付完後在帳本按「已付款」：${link}`,
  ].join('\n');
}
