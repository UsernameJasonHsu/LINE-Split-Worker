import type { ComputedExpense, ExpenseCategory } from '@line-split/core';
import { formatMoney } from '@line-split/core';

/**
 * Typing shortcuts for the expense form: past titles to pick from, a category
 * guessed from the title, and the message posted to the chat after saving.
 */

interface PastExpense {
  title: string;
  category: string | null;
  createdAt: number;
}

const normalize = (title: string) => title.trim().toLowerCase();

/** Distinct past titles, most recently used first. */
export function pastTitles(expenses: PastExpense[], limit = 30): string[] {
  const seen = new Set<string>();
  const titles: string[] = [];
  for (const e of [...expenses].sort((a, b) => b.createdAt - a.createdAt)) {
    const key = normalize(e.title);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    titles.push(e.title.trim());
    if (titles.length === limit) break;
  }
  return titles;
}

// Checked in order: lodging before food (飯店), transport before fun (機票).
const KEYWORDS: [ExpenseCategory, RegExp][] = [
  ['lodging', /飯店|旅館|民宿|酒店|住宿|hotel|airbnb|hostel|房租|租金/i],
  ['transport', /計程|小黃|taxi|uber|高鐵|台鐵|火車|捷運|地鐵|機票|航空|巴士|公車|客運|加油|油錢|停車|租車|過路|etc|船|新幹線|suica|悠遊卡/i],
  ['food', /餐|飯|麵|吃|食|咖啡|coffee|飲料|手搖|茶|酒|啤酒|火鍋|燒肉|燒烤|壽司|拉麵|便當|宵夜|甜點|蛋糕|麥當勞|披薩|pizza|早午/i],
  ['fun', /門票|入場|票|電影|ktv|唱歌|樂園|遊樂|展覽|博物館|溫泉|按摩|遊戲|活動|體驗/i],
  ['shopping', /買|購物|超市|全聯|好市多|costco|家樂福|超商|7-?11|全家|伴手禮|紀念品|藥妝|唐吉訶德|日用品/i],
];

/**
 * Category for a title: the latest past expense with the same title wins
 * (so the group's own habits beat the keyword list), else a keyword match.
 */
export function guessCategory(title: string, expenses: PastExpense[]): ExpenseCategory | null {
  const key = normalize(title);
  if (!key) return null;
  const past = [...expenses]
    .sort((a, b) => b.createdAt - a.createdAt)
    .find((e) => normalize(e.title) === key && e.category);
  if (past) return past.category as ExpenseCategory;
  return KEYWORDS.find(([, re]) => re.test(key))?.[0] ?? null;
}

/** Chat message announcing a new expense, e.g. "🧾 Alice 記了「晚餐」TWD 1,200". */
export function expenseNotice(
  title: string,
  computed: ComputedExpense,
  nameOf: (memberId: string) => string,
  link: string,
): string {
  const shares = computed.shares.filter((s) => s.shareMinor > 0);
  const amounts = new Set(shares.map((s) => s.shareMinor));
  const payers = computed.payers.map((p) => nameOf(p.memberId)).join('、');
  const split =
    amounts.size === 1
      ? `${shares.length} 人均分，每人 ${formatMoney(shares[0]!.shareMinor, computed.currency)}`
      : `${shares.length} 人分攤：${shares.map((s) => `${nameOf(s.memberId)} ${formatMoney(s.shareMinor, computed.currency)}`).join('、')}`;
  return [
    `🧾 「${title.trim()}」${formatMoney(computed.amountMinor, computed.currency)}`,
    `${payers} 付款，${split}`,
    `查看帳本：${link}`,
  ].join('\n');
}
