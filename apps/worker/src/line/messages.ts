import { formatMoney, type Transfer } from '@line-split/core';

const LINE_GREEN = '#06C755';

export const HELP_TEXT = [
  '分帳小幫手指令：',
  '・帳本：取得「➕ 記一筆」按鈕與帳本連結',
  '・結算：查看誰該付誰',
  '・回饋：回報問題或提出建議',
  '・說明：顯示這段說明',
  '',
  '小技巧：把「帳本」的回覆卡片長按「設為公告」，之後隨時從聊天室上方一鍵記帳。',
].join('\n');

export const DM_HELP_TEXT = [
  '記帳請到群組裡：輸入「帳本」，點卡片上的「➕ 記一筆」。',
  '可以直接點選，也可以在「說一句話」輸入框打字或用語音，例如「小明付了晚餐 1200，我跟小華分」。',
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

/** LIFF link that opens straight into a new expense. */
export const newExpenseUrl = (url: string) => `${url}&e=new`;

const openLedgerFooter = (url: string, { withAdd = false } = {}) => ({
  type: 'box',
  layout: 'vertical',
  spacing: 'sm',
  contents: [
    ...(withAdd
      ? [
          {
            type: 'button',
            style: 'primary',
            color: LINE_GREEN,
            action: { type: 'uri', label: '➕ 記一筆', uri: newExpenseUrl(url) },
          },
        ]
      : []),
    {
      type: 'button',
      style: withAdd ? 'secondary' : 'primary',
      ...(withAdd ? {} : { color: LINE_GREEN }),
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
      footer: openLedgerFooter(url, { withAdd: true }),
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
        spacing: 'sm',
        contents: [
          { type: 'text', text: `📒 ${ledgerName}`, weight: 'bold', wrap: true },
          { type: 'text', text: '長按這則訊息「設為公告」，之後隨時一鍵記帳', size: 'xs', color: '#888888', wrap: true },
        ],
      },
      footer: openLedgerFooter(url, { withAdd: true }),
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
