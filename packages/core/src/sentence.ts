import { evaluateAmount } from './arithmetic';
import { SUPPORTED_CURRENCIES } from './currency';

/**
 * Understands an everyday sentence about an expense, typed, dictated or
 * pasted: "小明付了計程車三百", "咖啡 一百五 我跟小華分", "拉麵 980 日幣".
 * Rule based and conservative: anything it isn't sure about is left null
 * (and stays in the title), so a miss means an empty field, never a wrong
 * payer or split.
 */

export interface SentenceMember {
  id: string;
  name: string;
}

export type SentenceSplit =
  | { kind: 'all' }
  | { kind: 'only'; memberIds: string[] }
  | { kind: 'except'; memberIds: string[] };

export interface ParsedSentence {
  /** As found: digits/arithmetic ("3,600", "450*2") or a converted Chinese numeral ("150"). */
  amount: string | null;
  currency: string | null;
  title: string | null;
  payerId: string | null;
  split: SentenceSplit | null;
}

const CURRENCY_WORDS: [string, string[]][] = [
  ['TWD', ['新台幣', '台幣', '臺幣']],
  ['JPY', ['日幣', '日圓', '日元', '円']],
  ['KRW', ['韓元', '韓幣', '韓圜']],
  ['USD', ['美金', '美元']],
  ['EUR', ['歐元']],
  ['GBP', ['英鎊']],
  ['HKD', ['港幣', '港元']],
  ['MOP', ['澳門幣', '葡幣']],
  ['CNY', ['人民幣']],
  ['SGD', ['新加坡幣', '新幣']],
  ['THB', ['泰銖']],
  ['MYR', ['馬幣', '令吉']],
  ['VND', ['越南盾', '越盾']],
  ['IDR', ['印尼盾']],
];

const CN_DIGIT: Record<string, number> = {
  零: 0, 〇: 0, 一: 1, 二: 2, 兩: 2, 两: 2, 三: 3, 四: 4, 五: 5, 六: 6, 七: 7, 八: 8, 九: 9,
};
const CN_UNIT: Record<string, number> = { 十: 10, 百: 100, 千: 1000 };
const CN_BIG = /[萬万]/;

const MONEY_SUFFIX = /^\s*(?:塊錢|块钱|塊|块|元|圓)/;
// "3人", "2杯", "第5": counts, not prices (written right after the number).
const COUNT_SUFFIX = /^(?:人|個|个|位|份|杯|碗|張|张|晚|天|次|點|点|號|号|樓|楼|%|折)/;
const DELIM = '，,。;；!！?？';
const SEPARATORS = '跟和與与、及,+&';

const SELF = new Set(['我', '自己', 'me']);

const toHalfWidth = (s: string) =>
  s.replace(/[！-～]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0xfee0)).replace(/　/g, ' ');

/** Letters and digits only, lower-cased: "阿美 Amy 🐶" → "阿美amy". */
const normalizeName = (s: string) => s.toLowerCase().replace(/[^\p{L}\p{N}]/gu, '');
const isCjk = (s: string) => /^[㐀-鿿]+$/.test(s);

/** "三百五" → 350, "一千二" → 1200, "1萬5" → 15000, "三百零五" → 305; null if not a numeral. */
export function chineseNumber(text: string): number | null {
  const [high, low, ...extra] = text.split(CN_BIG);
  if (extra.length) return null;
  if (low === undefined) return section(high!, null);
  const h = high === '' ? 1 : section(high!, null);
  const l = low === '' ? 0 : section(low, 10000);
  return h === null || l === null ? null : h * 10000 + l;
}

/**
 * A numeral below 10,000. A single digit right after a unit counts one unit
 * lower ("三百五" = 350, and after 萬 — `impliedUnit` — "1萬5" = 15000),
 * unless a 零 makes it plain units ("三百零五" = 305).
 */
function section(text: string, impliedUnit: number | null): number | null {
  let total = 0;
  let num: number | null = null;
  let numLength = 0;
  let lastUnit = impliedUnit;
  let zero = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i]!;
    if (/[0-9.]/.test(c)) {
      const m = text.slice(i).match(/^\d+(?:\.\d+)?/);
      if (!m) return null;
      num = Number(m[0]);
      numLength = m[0].length;
      i += m[0].length - 1;
    } else if (c in CN_DIGIT) {
      if (CN_DIGIT[c] === 0) zero = true;
      else {
        num = CN_DIGIT[c]!;
        numLength = 1;
      }
    } else if (c in CN_UNIT) {
      total += (num ?? 1) * CN_UNIT[c]!;
      lastUnit = CN_UNIT[c]!;
      num = null;
      zero = false;
    } else return null;
  }
  if (num !== null) total += lastUnit !== null && !zero && numLength === 1 ? (num * lastUnit) / 10 : num;
  return total;
}

interface AmountCandidate {
  start: number;
  end: number;
  amount: string;
  money: boolean;
}

function findAmount(text: string): AmountCandidate | null {
  const candidates: AmountCandidate[] = [];
  const mixed: [number, number][] = [];

  // Chinese or mixed numerals with a unit: 三百, 一千二, 1萬5, 3千.
  for (const m of text.matchAll(/[0-9.零〇一二兩两三四五六七八九十百千萬万]+/g)) {
    const raw = m[0];
    if (!/[十百千萬万]/.test(raw)) continue;
    const start = m.index!;
    const end = start + raw.length;
    const after = text.slice(end);
    const money = MONEY_SUFFIX.test(after);
    if (raw.length < 2 && !money) continue; // "十全大補湯"
    if (COUNT_SUFFIX.test(after) || text[start - 1] === '第') continue;
    const value = chineseNumber(raw);
    if (value === null || value <= 0) continue;
    mixed.push([start, end]);
    candidates.push({ start, end, amount: String(Number(value.toFixed(6))), money });
  }

  // Digits, optionally with thousands separators and arithmetic: 1200, 3,600, 450*2.
  const NUM = String.raw`(?:\d{1,3}(?:,\d{3})+|\d+)(?:\.\d+)?`;
  const expr = new RegExp(String.raw`${NUM}(?:\s*[+\-*/×÷]\s*${NUM})*`, 'g');
  for (const m of text.matchAll(expr)) {
    const start = m.index!;
    const end = start + m[0].length;
    if (mixed.some(([s, e]) => start < e && end > s)) continue;
    const after = text.slice(end);
    if (COUNT_SUFFIX.test(after) || text[start - 1] === '第') continue;
    const value = evaluateAmount(m[0], 2);
    if (value === null || Number(value) <= 0) continue; // "7-11"
    candidates.push({ start, end, amount: m[0].replace(/\s+/g, ''), money: MONEY_SUFFIX.test(after) });
  }

  if (candidates.length === 0) return null;
  candidates.sort((a, b) => a.start - b.start);
  // A number marked as money ("300元") wins; otherwise the last one (prices come last).
  return [...candidates].reverse().find((c) => c.money) ?? candidates.at(-1)!;
}

function findCurrency(text: string): { start: number; end: number; currency: string } | null {
  const supported = new Set(SUPPORTED_CURRENCIES);
  let best: { start: number; end: number; currency: string } | null = null;
  const consider = (start: number, end: number, currency: string) => {
    if (supported.has(currency) && (!best || start < best.start)) best = { start, end, currency };
  };
  for (const [code, words] of CURRENCY_WORDS) {
    for (const w of words) {
      const i = text.indexOf(w);
      if (i !== -1) consider(i, i + w.length, code);
    }
  }
  for (const m of text.matchAll(/(?<![A-Za-z])([A-Za-z]{3})(?![A-Za-z])/g)) {
    consider(m.index!, m.index! + 3, m[1]!.toUpperCase());
  }
  return best;
}

type Match = { id: string; rest: string };

function makeResolver(members: SentenceMember[], meId: string) {
  const named = members.map((m) => ({ id: m.id, key: normalizeName(m.name) }));

  const matchOne = (piece: string, allowShort: boolean): string | null => {
    if (SELF.has(piece.toLowerCase())) return meId;
    const n = normalizeName(piece);
    if (!n) return null;
    const exact = named.filter((m) => m.key === n);
    if (exact.length === 1) return exact[0]!.id;
    const minLength = allowShort && isCjk(n) ? 1 : 2;
    if (n.length < minLength) return null;
    const partial = named.filter((m) => m.key.includes(n));
    return partial.length === 1 ? partial[0]!.id : null;
  };

  /**
   * A member named by `token`, which may carry extra text before ("晚餐小明")
   * or after ("阿美都") the name depending on `side`; `rest` is that extra text.
   */
  return (token: string, side: 'before' | 'after' | 'none'): Match | null => {
    const whole = matchOne(token, true);
    if (whole) return { id: whole, rest: '' };
    if (side === 'none') return null;
    for (let k = token.length - 1; k >= 1; k--) {
      const name = side === 'before' ? token.slice(token.length - k) : token.slice(0, k);
      if (name.length < 2 && !SELF.has(name)) continue;
      const id = matchOne(name, false);
      if (id) return { id, rest: side === 'before' ? token.slice(0, token.length - k) : token.slice(k) };
    }
    return null;
  };
}

const PAYER_VERB = /(?:先)?(?:付了|付的|付錢|付款|付|出了|出的|出錢|買單|結帳|刷卡|代墊|墊)/g;
const SPLIT_VERB = new RegExp(String.raw`(?:一起)?(?:平分|均分|分攤|分帳|分)(?=$|[\s${DELIM}])`, 'g');
const ALL = new RegExp(String.raw`(?:大家|所有人|全員)(?:一起)?(?:平分|均分|分攤|分)?|全部(?:人)?(?:一起)?(?:平分|均分|分攤|分)`);
const EXCEPT = /(?:除了|扣掉|不含|不算)\s*/;
const TOKEN_END = new RegExp(String.raw`[^\s${DELIM}${SEPARATORS}]+$`);
const TOKEN_START = new RegExp(String.raw`^[^\s${DELIM}${SEPARATORS}]+`);
const SEP_END = new RegExp(String.raw`[\s${SEPARATORS}]+$`);
const SEP_START = new RegExp(String.raw`^[\s${SEPARATORS}]+`);

export function parseSentence(input: string, members: SentenceMember[], meId: string): ParsedSentence {
  const resolve = makeResolver(members, meId);
  let text = toHalfWidth(input).trim();
  const result: ParsedSentence = { amount: null, currency: null, title: null, payerId: null, split: null };
  const cut = (start: number, end: number) => {
    text = `${text.slice(0, start)} ${text.slice(end)}`;
  };

  const amount = findAmount(text);
  if (amount) {
    result.amount = amount.amount;
    const suffix = text.slice(amount.end).match(MONEY_SUFFIX)?.[0] ?? '';
    cut(amount.start, amount.end + suffix.length);
  }

  const currency = findCurrency(text);
  if (currency) {
    result.currency = currency.currency;
    cut(currency.start, currency.end);
  }

  // Payer: "小明付了", "晚餐我付", "Amy 先付".
  for (const m of text.matchAll(PAYER_VERB)) {
    const before = text.slice(0, m.index!).replace(/\s+$/, '');
    const token = before.match(TOKEN_END)?.[0];
    if (!token) continue;
    const found = resolve(token, 'before');
    if (!found) continue;
    result.payerId = found.id;
    text = `${before.slice(0, before.length - token.length)}${found.rest} ${text.slice(m.index! + m[0].length)}`;
    break;
  }

  // Everyone: "大家分", "全部一起分".
  const all = text.match(ALL);
  if (all) {
    result.split = { kind: 'all' };
    cut(all.index!, all.index! + all[0].length);
  }

  // Everyone but: "除了阿美", "扣掉小明以外".
  const except = !result.split && text.match(EXCEPT);
  if (except) {
    let rest = text.slice(except.index! + except[0].length);
    const ids: string[] = [];
    for (;;) {
      const token = rest.match(TOKEN_START)?.[0];
      const found = token && resolve(token, 'after');
      if (!found) break;
      ids.push(found.id);
      rest = found.rest + rest.slice(token.length);
      if (found.rest) break;
      const stripped = rest.replace(SEP_START, '');
      if (stripped === rest) break;
      rest = stripped;
    }
    if (ids.length) {
      result.split = { kind: 'except', memberIds: [...new Set(ids)] };
      rest = rest.replace(/^(?:以外|之外)?(?:都|一起)?(?:平分|均分|分攤|分)?/, '');
      text = `${text.slice(0, except.index!)} ${rest}`;
    }
  }

  // Only these people: "我跟小華分", "小明 小華 平分".
  if (!result.split) {
    for (const m of text.matchAll(SPLIT_VERB)) {
      let before = text.slice(0, m.index!);
      const ids: string[] = [];
      for (;;) {
        before = before.replace(/\s+$/, '');
        const token = before.match(TOKEN_END)?.[0];
        const found = token && resolve(token, 'before');
        if (!found) break;
        ids.unshift(found.id);
        before = before.slice(0, before.length - token.length) + found.rest;
        if (found.rest) break;
        const stripped = before.replace(SEP_END, '');
        if (stripped === before) break;
        before = stripped;
      }
      if (ids.length) {
        result.split = { kind: 'only', memberIds: [...new Set(ids)] };
        text = `${before} ${text.slice(m.index! + m[0].length)}`;
        break;
      }
    }
  }

  const title = text
    .replace(new RegExp(`[${DELIM}]+`, 'g'), ' ')
    .replace(/^\s*(?:總共|一共|共|花了)/, '')
    .replace(/(?:\s|了|的)+$/, '')
    .replace(/\s+/g, ' ')
    .trim();
  result.title = title || null;
  return result;
}
