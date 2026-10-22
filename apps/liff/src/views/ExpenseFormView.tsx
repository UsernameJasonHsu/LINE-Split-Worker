import { formatMoney, SUPPORTED_CURRENCIES } from '@line-split/core';
import { useEffect, useMemo, useState } from 'react';
import { AmountInput } from '../AmountInput';
import { errorMessage } from '../api';
import { navigate, type ViewProps } from '../App';
import type { Member } from '../api';
import { Avatar, memberLookup, Money, TopBar } from '../components';
import { CATEGORY_META, EXPENSE_CATEGORIES } from '../lib/categories';
import {
  emptyForm,
  fixedRestRemainder,
  formFromExpense,
  toDateInput,
  toPayload,
  validate,
  type ExpenseForm,
} from '../lib/form';
import { describeParsed, parseForForm, sentencePatch, type SentenceField } from '../lib/sentenceForm';
import { expenseNotice, frequentTitles, guessCategory, pastTitles } from '../lib/suggest';
import { canSendToChat, ledgerLink, trySendToChat } from '../liff';
import { useEntryTracking } from '../useEntryTracking';

const POST_TO_CHAT_KEY = 'postNewExpenseToChat';

/** How the last new expense was entered, to open the next one the same way. */
const ENTRY_MODE_KEY = 'expenseEntryMode';

function loadEntryMode(): 'sentence' | 'form' {
  try {
    return localStorage.getItem(ENTRY_MODE_KEY) === 'sentence' ? 'sentence' : 'form';
  } catch {
    return 'form';
  }
}

function saveEntryMode(mode: 'sentence' | 'form') {
  try {
    localStorage.setItem(ENTRY_MODE_KEY, mode);
  } catch {
    // Not remembered; the form just opens on the amount next time.
  }
}

function loadPostToChat(): boolean {
  try {
    // Off unless chosen: posting every expense would clutter the group chat.
    return localStorage.getItem(POST_TO_CHAT_KEY) === 'on';
  } catch {
    return false;
  }
}

const SPLIT_TABS = [
  { type: 'equal', label: '均分' },
  { type: 'weights', label: '份數' },
  { type: 'exact', label: '指定金額' },
  { type: 'fixed_rest', label: '部分指定' },
] as const;

export function ExpenseFormView({ api, data, reload, notify, expenseId }: ViewProps & { expenseId: string | null }) {
  const { view } = data;
  const base = view.ledger.baseCurrency;
  const members = view.members;
  const existing = expenseId ? data.expenses.find((e) => e.id === expenseId) : undefined;
  const readOnly = view.ledger.closedAt !== null;

  const [form, setForm] = useState<ExpenseForm>(() =>
    existing ? formFromExpense(existing, members) : emptyForm(members, view.meMemberId, base),
  );
  const [fxNote, setFxNote] = useState<string | null>(null);
  const [submitted, setSubmitted] = useState(false);
  const [busy, setBusy] = useState(false);
  const set = (patch: Partial<ExpenseForm>) => setForm((f) => ({ ...f, ...patch }));

  // New expenses: suggest past titles and guess the category from the title
  // until the user picks one themselves.
  const titles = useMemo(() => (existing ? [] : pastTitles(data.expenses)), [existing, data.expenses]);
  const [categoryPicked, setCategoryPicked] = useState(!!existing);
  const setTitle = (title: string) =>
    set(categoryPicked ? { title } : { title, category: guessCategory(title, data.expenses) });

  // Frequent titles are one tap; category, date and note are folded away,
  // with their current values shown on the fold.
  const quickTitles = useMemo(() => (existing ? [] : frequentTitles(data.expenses)), [existing, data.expenses]);
  const [moreOpen, setMoreOpen] = useState(readOnly || !!existing?.note);
  const moreSummary = [
    form.category ? `${CATEGORY_META[form.category].emoji} ${CATEGORY_META[form.category].label}` : '未分類',
    form.date === toDateInput(Date.now()) ? '今天' : form.date.replace(/^\d{4}-0?(\d+)-0?(\d+)$/, '$1/$2'),
    ...(form.note.trim() ? ['有備註'] : []),
  ].join('・');

  // One-line input ("小明付了晚餐 1200，我跟小華分") that fills the fields below
  // live; a field edited by hand is no longer overwritten by it.
  const [sentence, setSentence] = useState('');
  const [preferSentence] = useState(() => !existing && !readOnly && loadEntryMode() === 'sentence');
  const [touched, setTouched] = useState<ReadonlySet<SentenceField>>(new Set());
  const touch = (field: SentenceField) => setTouched((t) => (t.has(field) ? t : new Set(t).add(field)));
  const parsedSentence = useMemo(
    () => (sentence.trim() ? parseForForm(sentence, members, view.meMemberId) : null),
    [sentence, members, view.meMemberId],
  );
  const onSentence = (text: string) => {
    setSentence(text);
    const patch = sentencePatch(parseForForm(text, members, view.meMemberId), touched, members, view.meMemberId, base);
    if (patch.currency !== undefined && patch.currency !== form.currency) {
      Object.assign(patch, { fxRateEdited: false, fxRate: '' });
    }
    if (patch.title !== undefined && !categoryPicked) patch.category = guessCategory(patch.title, data.expenses);
    set(patch);
  };
  const shortName = (id: string) => (id === view.meMemberId ? '我' : (members.find((m) => m.id === id)?.displayName ?? '?'));

  const chatAvailable = !existing && canSendToChat();
  const [postToChat, setPostToChat] = useState(loadPostToChat);
  const togglePostToChat = (on: boolean) => {
    setPostToChat(on);
    try {
      localStorage.setItem(POST_TO_CHAT_KEY, on ? 'on' : 'off');
    } catch {
      // Private mode etc.: the choice just isn't remembered.
    }
  };

  // Fetch today's rate when picking a foreign currency (an edited rate or the
  // original rate of an existing expense in the same currency is kept).
  useEffect(() => {
    if (form.currency === base) {
      setFxNote(null);
      return;
    }
    if (form.fxRateEdited || readOnly) return;
    if (existing && existing.currency === form.currency) {
      setForm((f) => ({ ...f, fxRate: existing.fxRate }));
      setFxNote(existing.fxSource === 'MANUAL' ? '記帳時手動輸入的匯率' : '記帳當時的參考匯率');
      return;
    }
    let cancelled = false;
    setFxNote('取得今日匯率中…');
    api
      .fx(form.currency, base)
      .then((q) => {
        if (cancelled) return;
        setForm((f) => (f.fxRateEdited ? f : { ...f, fxRate: q.rate }));
        setFxNote(`${q.date} 市場參考匯率，可改成刷卡匯率`);
      })
      .catch((err) => !cancelled && setFxNote(errorMessage(err)));
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- refetch only when the currency changes
  }, [form.currency]);

  const entry = useEntryTracking(api, !expenseId && !readOnly, () => (sentence.trim() ? 'sentence' : 'form'));

  const validation = useMemo(() => validate(form, base, members), [form, base, members]);
  const titleError = form.title.trim() === '' ? '請輸入項目名稱' : null;
  const showErrors = submitted;

  if (expenseId && !existing) {
    return (
      <main className="page">
        <TopBar title="支出" onBack={() => navigate({ name: 'home' })} />
        <p className="empty">找不到這筆支出，可能已被刪除。</p>
      </main>
    );
  }

  async function save() {
    setSubmitted(true);
    if (titleError || !validation.ok) return;
    setBusy(true);
    try {
      const body = toPayload(form, base, members);
      if (existing) await api.updateExpense(existing.id, { ...body, revision: existing.revision });
      else {
        const source = sentence.trim() ? 'sentence' : 'form';
        await api.createExpense({ ...body, source });
        entry.saved(source);
        saveEntryMode(source);
        if (chatAvailable && postToChat && validation.ok) {
          const names = memberLookup(members);
          await trySendToChat(expenseNotice(form.title, validation.computed, names.name, ledgerLink(view.ledger.id)));
        }
      }
      await reload();
      navigate({ name: 'home' });
    } catch (err) {
      notify(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  async function remove() {
    if (!existing || !window.confirm(`刪除「${existing.title}」？`)) return;
    setBusy(true);
    try {
      await api.deleteExpense(existing.id);
      await reload();
      navigate({ name: 'home' });
    } catch (err) {
      notify(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  const shareOf = new Map(validation.ok ? validation.computed.shares.map((s) => [s.memberId, s]) : []);
  const step = (id: string, delta: number) => {
    touch('split');
    set({ weights: { ...form.weights, [id]: Math.max(0, (form.weights[id] ?? 0) + delta) } });
  };
  const toggle = (id: string) => {
    touch('split');
    set({ equalIds: form.equalIds.includes(id) ? form.equalIds.filter((x) => x !== id) : [...form.equalIds, id] });
  };
  const allSelected = form.equalIds.length === members.length;
  const toggleRest = (id: string) => {
    touch('split');
    set({ restIds: form.restIds.includes(id) ? form.restIds.filter((x) => x !== id) : [...form.restIds, id] });
  };
  const remainder = form.splitType === 'fixed_rest' ? fixedRestRemainder(form, members) : null;

  // Switching to several payers starts from "the single payer paid everything".
  const togglePayerMode = () => {
    touch('payer');
    if (form.multiPayer) {
      set({
        multiPayer: false,
        payerId: members.find((m) => (form.payerAmounts[m.id] ?? '').trim() !== '')?.id ?? form.payerId,
      });
    } else set({ multiPayer: true, payerAmounts: { [form.payerId]: form.amount } });
  };

  return (
    <main className={readOnly ? 'page' : 'page with-footer'}>
      <TopBar
        title={readOnly ? '支出明細' : existing ? '編輯支出' : '新增支出'}
        onBack={() => navigate({ name: 'home' })}
      />
      {readOnly && <p className="banner">這本帳本已結束，僅供查看。</p>}

      <fieldset className="plain" disabled={readOnly}>
        <section className="card form">
          {!existing && !readOnly && (
            <label className="field sentence-field">
              <span>說一句話（可用鍵盤的語音輸入）</span>
              <input
                value={sentence}
                onChange={(e) => onSentence(e.target.value)}
                onKeyDown={(e) => {
                  // 完成/Enter saves once an amount is understood; Enter that
                  // confirms an input-method candidate (注音, 拼音) doesn't.
                  if (e.key !== 'Enter' || e.nativeEvent.isComposing || e.keyCode === 229) return;
                  e.preventDefault();
                  if (parsedSentence?.amount) void save();
                }}
                placeholder="例如：小明付了晚餐 1200，我跟小華分"
                enterKeyHint={parsedSentence?.amount ? 'done' : 'enter'}
                autoFocus={preferSentence}
                maxLength={200}
              />
              {parsedSentence && (
                <small className="sentence-result">
                  認出：{describeParsed(parsedSentence, shortName, base)}
                  {parsedSentence.amount && <span className="sentence-hint">　按「完成」直接儲存</span>}
                </small>
              )}
            </label>
          )}

          <div className="field">
            <span>金額</span>
            <div className="amount-row">
              <select
                aria-label="幣別"
                value={form.currency}
                onChange={(e) => {
                  touch('currency');
                  set({ currency: e.target.value, fxRateEdited: false, fxRate: '' });
                }}
              >
                {SUPPORTED_CURRENCIES.map((c) => (
                  <option key={c} value={c}>
                    {c}
                  </option>
                ))}
              </select>
              <AmountInput
                value={form.amount}
                onChange={(amount) => {
                  touch('amount');
                  set({ amount });
                }}
                currency={form.currency}
                className="amount-input"
                ariaLabel="金額"
                withKeys={!readOnly}
                autoFocus={!existing && !readOnly && !preferSentence}
              />
            </div>
          </div>

          {form.currency !== base && (
            <label className="field">
              <span>
                匯率（1 {form.currency} = ? {base}）
              </span>
              <input
                inputMode="decimal"
                value={form.fxRate}
                onChange={(e) => set({ fxRate: e.target.value, fxRateEdited: true })}
              />
              {fxNote && !form.fxRateEdited && <small className="muted">{fxNote}</small>}
              {form.fxRateEdited && <small className="muted">使用手動輸入的匯率</small>}
              {validation.ok && (
                <small className="muted">
                  ≈ <Money minor={validation.computed.baseAmountMinor} currency={base} />
                </small>
              )}
            </label>
          )}

          <label className="field">
            <span>項目</span>
            <input
              value={form.title}
              onChange={(e) => {
                touch('title');
                setTitle(e.target.value);
              }}
              placeholder="例如：晚餐、計程車"
              maxLength={100}
              list={titles.length ? 'past-titles' : undefined}
            />
            {titles.length > 0 && (
              <datalist id="past-titles">
                {titles.map((t) => (
                  <option key={t} value={t} />
                ))}
              </datalist>
            )}
            {showErrors && titleError && <small className="error">{titleError}</small>}
          </label>
          {quickTitles.length > 0 && (
            <div className="chips wrap quick-titles" aria-label="常用項目">
              {quickTitles.map((t) => (
                <button
                  key={t}
                  type="button"
                  className={`chip ${form.title.trim() === t ? 'active' : ''}`}
                  onClick={() => {
                    touch('title');
                    setTitle(t);
                  }}
                >
                  {t}
                </button>
              ))}
            </div>
          )}

          <div className="field">
            <span className="field-head">
              <span>誰付的</span>
              {!readOnly && (
                <button type="button" className="link-button" onClick={togglePayerMode}>
                  {form.multiPayer ? '改回單人付款' : '多人付款'}
                </button>
              )}
            </span>
            {form.multiPayer ? (
              <ul className="list">
                {members.map((m) => (
                  <li key={m.id} className="split-row">
                    <span className="split-label">
                      <Avatar member={m} size={28} />
                      <span>{m.displayName}</span>
                    </span>
                    <AmountInput
                      className="exact-input"
                      value={form.payerAmounts[m.id] ?? ''}
                      onChange={(v) => {
                        touch('payer');
                        setForm((f) => ({ ...f, payerAmounts: { ...f.payerAmounts, [m.id]: v } }));
                      }}
                      currency={form.currency}
                      ariaLabel={`${m.displayName} 付的金額`}
                    />
                  </li>
                ))}
              </ul>
            ) : (
              <div className="person-chips" role="radiogroup" aria-label="付款人">
                {members.map((m) => (
                  <PersonChip
                    key={m.id}
                    member={m}
                    me={m.id === view.meMemberId}
                    active={form.payerId === m.id}
                    role="radio"
                    onClick={() => {
                      touch('payer');
                      set({ payerId: m.id });
                    }}
                  />
                ))}
              </div>
            )}
            {!validation.ok && validation.field === 'payers' && (showErrors || form.amount !== '') && (
              <p className="error">{validation.error}</p>
            )}
          </div>

          <div className="field">
            <span className="field-head">
              <span>分攤</span>
              {form.splitType === 'equal' && !readOnly && (
                <button
                  type="button"
                  className="link-button"
                  onClick={() => {
                    touch('split');
                    set({ equalIds: allSelected ? [] : members.map((m) => m.id) });
                  }}
                >
                  {allSelected ? '全部取消' : '全選'}
                </button>
              )}
            </span>
          <div className="segmented" role="tablist">
            {SPLIT_TABS.map((t) => (
              <button
                key={t.type}
                type="button"
                role="tab"
                aria-selected={form.splitType === t.type}
                className={form.splitType === t.type ? 'active' : ''}
                onClick={() => {
                  touch('split');
                  set({ splitType: t.type });
                }}
              >
                {t.label}
              </button>
            ))}
          </div>
            {form.splitType === 'equal' ? (
              <div className="person-chips" aria-label="分攤的人">
                {members.map((m) => (
                  <PersonChip
                    key={m.id}
                    member={m}
                    me={m.id === view.meMemberId}
                    active={form.equalIds.includes(m.id)}
                    role="checkbox"
                    onClick={() => toggle(m.id)}
                    note={shareOf.get(m.id) ? formatMoney(shareOf.get(m.id)!.shareMinor, form.currency) : undefined}
                  />
                ))}
              </div>
            ) : (
              <>
          {form.splitType === 'fixed_rest' && (
            <p className="split-hint small">
              先填有指定金額的人，剩下的由勾選「平分」的人均分。
              {remainder !== null && remainder >= 0 && (
                <>
                  <br />
                  剩餘 <strong>{formatMoney(remainder, form.currency)}</strong>
                  {form.restIds.length > 0 ? ` 由 ${form.restIds.length} 人平分` : '，尚未勾選平分的人'}
                </>
              )}
            </p>
          )}
          <ul className="list">
            {members.map((m) => {
              const share = shareOf.get(m.id);
              return (
                <li key={m.id} className="split-row">
                  <span className="split-label">
                    <Avatar member={m} size={28} />
                    <span>{m.displayName}</span>
                  </span>

                  {form.splitType === 'weights' && (
                    <span className="stepper">
                      <button type="button" onClick={() => step(m.id, -1)} aria-label="減少">
                        −
                      </button>
                      <span>{form.weights[m.id] ?? 0}</span>
                      <button type="button" onClick={() => step(m.id, 1)} aria-label="增加">
                        ＋
                      </button>
                    </span>
                  )}
                  {form.splitType === 'exact' && (
                    <AmountInput
                      className="exact-input"
                      value={form.exact[m.id] ?? ''}
                      onChange={(v) => {
                        touch('split');
                        setForm((f) => ({ ...f, exact: { ...f.exact, [m.id]: v } }));
                      }}
                      currency={form.currency}
                      ariaLabel={`${m.displayName} 的金額`}
                    />
                  )}
                  {form.splitType === 'fixed_rest' && (
                    <>
                      <AmountInput
                        className="exact-input"
                        value={form.fixed[m.id] ?? ''}
                        onChange={(v) => {
                          touch('split');
                          setForm((f) => ({ ...f, fixed: { ...f.fixed, [m.id]: v } }));
                        }}
                        currency={form.currency}
                        placeholder="指定"
                        ariaLabel={`${m.displayName} 的指定金額`}
                      />
                      <label className="rest-toggle">
                        <input
                          type="checkbox"
                          checked={form.restIds.includes(m.id)}
                          onChange={() => toggleRest(m.id)}
                        />
                        <span>平分</span>
                      </label>
                    </>
                  )}
                  <span className="split-share">{share ? formatMoney(share.shareMinor, form.currency) : '—'}</span>
                </li>
              );
            })}
          </ul>
              </>
            )}
          {!validation.ok && validation.field !== 'payers' && (showErrors || form.amount !== '') && (
            <p className="error">{validation.error}</p>
          )}
          </div>
        </section>

        <details className="more-options" open={moreOpen} onToggle={(e) => setMoreOpen(e.currentTarget.open)}>
          <summary>
            分類、日期、備註
            <span className="more-summary">{moreSummary}</span>
          </summary>
          <section className="card form">
          <div className="field">
            <span>分類</span>
            <div className="chips wrap" role="radiogroup" aria-label="分類">
              {EXPENSE_CATEGORIES.map((c) => (
                <button
                  key={c}
                  type="button"
                  role="radio"
                  aria-checked={form.category === c}
                  className={`chip ${form.category === c ? 'active' : ''}`}
                  onClick={() => {
                    setCategoryPicked(true);
                    set({ category: form.category === c ? null : c });
                  }}
                >
                  {CATEGORY_META[c].emoji} {CATEGORY_META[c].label}
                </button>
              ))}
            </div>
          </div>

          <label className="field">
            <span>日期</span>
            <input type="date" value={form.date} onChange={(e) => set({ date: e.target.value })} />
          </label>

          <label className="field">
            <span>備註（選填）</span>
            <textarea
              value={form.note}
              onChange={(e) => set({ note: e.target.value })}
              placeholder="例如：含一成服務費、小孩半價"
              maxLength={500}
              rows={2}
            />
          </label>
          </section>
        </details>
      </fieldset>

      {existing && !readOnly && (
        <button type="button" className="button danger block" onClick={remove} disabled={busy}>
          刪除這筆支出
        </button>
      )}

      {!readOnly && (
        <footer className="sticky-footer">
          {chatAvailable && (
            <label className="footer-option">
              <input type="checkbox" checked={postToChat} onChange={(e) => togglePostToChat(e.target.checked)} />
              同時傳到聊天室，讓大家知道
            </label>
          )}
          <button type="button" className="button primary block" onClick={save} disabled={busy}>
            {busy ? '儲存中…' : '儲存'}
          </button>
        </footer>
      )}
    </main>
  );
}

/** A tappable member avatar with name (payer / split pickers). */
function PersonChip({
  member,
  me,
  active,
  role,
  onClick,
  note,
}: {
  member: Member;
  me: boolean;
  active: boolean;
  role: 'radio' | 'checkbox';
  onClick: () => void;
  note?: string;
}) {
  return (
    <button
      type="button"
      role={role}
      aria-checked={active}
      className={`person-chip ${active ? 'active' : ''}`}
      onClick={onClick}
    >
      <Avatar member={member} size={32} />
      <span className="person-name">{me ? '我' : member.displayName}</span>
      {note && <span className="person-note">{note}</span>}
    </button>
  );
}
