import { formatMoney, type Transfer } from '@line-split/core';
import type { ExpenseDto } from '../services/expenses';

const LINE_GREEN = '#06C755';

export const HELP_TEXT = [
  '分帳小幫手指令：',
  '・帳本：取得記帳連結',
  '・結算：查看誰該付誰',
  '・回饋：回報問題或提出建議',
  '・說明：顯示這段說明',
  '',
  '想快速記帳又不想洗版？加我好友後私訊「午餐 1200」就能記到帳本。',
].join('\n');

export const DM_HELP_TEXT = [
  '在這裡傳一句話就能記帳，不會出現在群組裡：',
  '・午餐 1200',
  '・1200 計程車',
  '・拉麵 980 JPY（外幣自動換匯）',
  '・披薩 450*2（可以用算式）',
  '',
  '預設是你付款、帳本全員均分。要指定誰分攤，在後面加 @名字：',
  '・午餐 1200 @小明 @小華（只有他們兩人均分）',
  '・午餐 1200 @我 @小明（你和小明均分）',
  '・午餐 1200 @小明 500 @我 @小華（小明出 500，其餘你和小華均分）',
  '',
  '名字打部分即可；記好後也可以點「修改」再調整。',
].join('\n');

export function liffUrl(liffId: string, ledgerId: string): string {
  return `https://liff.line.me/${liffId}?l=${encodeURIComponent(ledgerId)}`;
}

export function feedbackUrl(liffId: string, ledgerId?: string): string {
  const ledger = ledgerId ? `&l=${encodeURIComponent(ledgerId)}` : '';
  return `https://liff.line.me/${liffId}?view=feedback${ledger}`;
}

export function adminFeedbackUrl(liffId: string): string {
  return `https://liff.line.me/${liffId}?view=admin`;
}

const openLedgerFooter = (url: string) => ({
  type: 'box',
  layout: 'vertical',
  contents: [
    {
      type: 'button',
      style: 'primary',
      color: LINE_GREEN,
      action: { type: 'uri', label: '打開帳本', uri: url },
    },
  ],
});

export function welcomeMessage(ledgerName: string, url: string) {
  return {
    type: 'flex',
    altText: '分帳小幫手已加入，點此打開帳本',
    contents: {
      type: 'bubble',
      body: {
        type: 'box',
        layout: 'vertical',
        spacing: 'md',
        contents: [
          { type: 'text', text: '分帳小幫手已加入 👋', weight: 'bold', size: 'lg' },
          {
            type: 'text',
            text: `已建立帳本「${ledgerName}」。點下方按鈕開始記帳；在群組輸入「結算」可查看誰該付誰。`,
            wrap: true,
            size: 'sm',
            color: '#555555',
          },
        ],
      },
      footer: openLedgerFooter(url),
    },
  };
}

export function ledgerLinkMessage(ledgerName: string, url: string) {
  return {
    type: 'flex',
    altText: `打開帳本「${ledgerName}」`,
    contents: {
      type: 'bubble',
      size: 'kilo',
      body: {
        type: 'box',
        layout: 'vertical',
        contents: [{ type: 'text', text: `📒 ${ledgerName}`, weight: 'bold', wrap: true }],
      },
      footer: openLedgerFooter(url),
    },
  };
}

export function noOpenLedgerMessage(lastLedgerName: string, url: string) {
  return {
    type: 'flex',
    altText: '目前沒有進行中的帳本',
    contents: {
      type: 'bubble',
      size: 'kilo',
      body: {
        type: 'box',
        layout: 'vertical',
        spacing: 'sm',
        contents: [
          { type: 'text', text: '目前沒有進行中的帳本', weight: 'bold', wrap: true },
          {
            type: 'text',
            text: `上一本「${lastLedgerName}」已結束。準備好下一次的主題後，點下方按鈕開新帳本。`,
            wrap: true,
            size: 'sm',
            color: '#555555',
          },
        ],
      },
      footer: {
        type: 'box',
        layout: 'vertical',
        contents: [
          {
            type: 'button',
            style: 'primary',
            color: LINE_GREEN,
            action: { type: 'uri', label: '開新帳本', uri: url },
          },
        ],
      },
    },
  };
}

export interface SummaryView {
  ledgerName: string;
  closed?: boolean;
  baseCurrency: string;
  totalSpentMinor: number;
  transfers: Transfer[];
  nameOf: (memberId: string) => string;
}

export function summaryMessage(view: SummaryView, url: string) {
  const { ledgerName, closed, baseCurrency, totalSpentMinor, transfers, nameOf } = view;
  const title = `${ledgerName} 結算${closed ? '（已結束）' : ''}`;
  const rows =
    transfers.length === 0
      ? [{ type: 'text', text: '目前沒有待結清的款項 🎉', size: 'sm', color: '#555555' }]
      : transfers.map((t) => ({
          type: 'box',
          layout: 'horizontal',
          contents: [
            { type: 'text', text: `${nameOf(t.from)} → ${nameOf(t.to)}`, size: 'sm', flex: 3, wrap: true },
            {
              type: 'text',
              text: formatMoney(t.amountMinor, baseCurrency),
              size: 'sm',
              flex: 2,
              align: 'end',
              weight: 'bold',
            },
          ],
        }));

  return {
    type: 'flex',
    altText: `「${ledgerName}」結算${closed ? '（已結束）' : ''}：${transfers.length} 筆待轉帳`,
    contents: {
      type: 'bubble',
      body: {
        type: 'box',
        layout: 'vertical',
        spacing: 'md',
        contents: [
          { type: 'text', text: title, weight: 'bold', size: 'lg', wrap: true },
          {
            type: 'text',
            text: `總支出 ${formatMoney(totalSpentMinor, baseCurrency)}`,
            size: 'xs',
            color: '#888888',
          },
          { type: 'separator' },
          ...rows,
        ],
      },
      footer: openLedgerFooter(url),
    },
  };
}

export interface QuickReplyItem {
  type: 'action';
  action: { type: 'postback'; label: string; data: string; displayText: string };
}

/** Confirms an expense recorded from the private chat, with edit / undo buttons. */
export function entryConfirmMessage(view: {
  ledgerName: string;
  expense: ExpenseDto;
  payerName: string;
  /** e.g. "4 人均分，每人 TWD 300". */
  splitText: string;
  editUrl: string;
  undoData: string;
  quickReply: QuickReplyItem[];
}) {
  const { ledgerName, expense, payerName, splitText, editUrl, undoData, quickReply } = view;
  const amount = formatMoney(expense.amountMinor, expense.currency);
  return {
    type: 'flex',
    altText: `已記到「${ledgerName}」：${expense.title} ${amount}`,
    contents: {
      type: 'bubble',
      size: 'kilo',
      body: {
        type: 'box',
        layout: 'vertical',
        spacing: 'sm',
        contents: [
          { type: 'text', text: `✅ 已記到「${ledgerName}」`, size: 'xs', color: '#888888', wrap: true },
          {
            type: 'box',
            layout: 'horizontal',
            contents: [
              { type: 'text', text: expense.title, weight: 'bold', wrap: true, flex: 3 },
              { type: 'text', text: amount, weight: 'bold', align: 'end', flex: 2 },
            ],
          },
          { type: 'text', text: `${payerName} 付款；${splitText}`, size: 'sm', color: '#555555', wrap: true },
        ],
      },
      footer: {
        type: 'box',
        layout: 'horizontal',
        spacing: 'sm',
        contents: [
          { type: 'button', style: 'secondary', height: 'sm', action: { type: 'uri', label: '修改', uri: editUrl } },
          {
            type: 'button',
            style: 'secondary',
            height: 'sm',
            action: { type: 'postback', label: '復原', data: undoData, displayText: '復原這筆' },
          },
        ],
      },
    },
    ...(quickReply.length ? { quickReply: { items: quickReply } } : {}),
  };
}
