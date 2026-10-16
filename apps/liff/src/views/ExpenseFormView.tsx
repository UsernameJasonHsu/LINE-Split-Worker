import { decimalsOf, formatMoney, SUPPORTED_CURRENCIES } from '@line-split/core';
import { useEffect, useMemo, useState } from 'react';
import { errorMessage } from '../api';
import { navigate, type ViewProps } from '../App';
import { Avatar, Money, TopBar } from '../components';
import { emptyForm, formFromExpense, toPayload, validate, type ExpenseForm } from '../lib/form';

const SPLIT_TABS = [
  { type: 'equal', label: '均分' },
  { type: 'weights', label: '份數' },
  { type: 'exact', label: '指定金額' },
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
      else await api.createExpense(body);
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
  const step = (id: string, delta: number) =>
    set({ weights: { ...form.weights, [id]: Math.max(0, (form.weights[id] ?? 0) + delta) } });
  const toggle = (id: string) =>
    set({ equalIds: form.equalIds.includes(id) ? form.equalIds.filter((x) => x !== id) : [...form.equalIds, id] });
  const allSelected = form.equalIds.length === members.length;

  // Switching to several payers starts from "the single payer paid everything".
  const togglePayerMode = () =>
    form.multiPayer
      ? set({
          multiPayer: false,
          payerId: members.find((m) => (form.payerAmounts[m.id] ?? '').trim() !== '')?.id ?? form.payerId,
        })
      : set({ multiPayer: true, payerAmounts: { [form.payerId]: form.amount } });

  return (
    <main className={readOnly ? 'page' : 'page with-footer'}>
      <TopBar
        title={readOnly ? '支出明細' : existing ? '編輯支出' : '新增支出'}
        onBack={() => navigate({ name: 'home' })}
      />
      {readOnly && <p className="banner">這本帳本已結束，僅供查看。</p>}

      <fieldset className="plain" disabled={readOnly}>
        <section className="card form">
          <label className="field">
            <span>項目</span>
            <input
              value={form.title}
              onChange={(e) => set({ title: e.target.value })}
              placeholder="例如：晚餐、計程車"
              maxLength={100}
            />
            {showErrors && titleError && <small className="error">{titleError}</small>}
          </label>

          <div className="field">
            <span>金額</span>
            <div className="amount-row">
              <select
                aria-label="幣別"
                value={form.currency}
                onChange={(e) => set({ currency: e.target.value, fxRateEdited: false, fxRate: '' })}
              >
                {SUPPORTED_CURRENCIES.map((c) => (
                  <option key={c} value={c}>
                    {c}
                  </option>
                ))}
              </select>
              <input
                inputMode={decimalsOf(form.currency) === 0 ? 'numeric' : 'decimal'}
                value={form.amount}
                onChange={(e) => set({ amount: e.target.value })}
                placeholder="0"
                className="amount-input"
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
            <span>日期</span>
            <input type="date" value={form.date} onChange={(e) => set({ date: e.target.value })} />
          </label>
        </section>

        <section className="card form">
          <div className="field">
            <span className="field-head">
              <span>付款人</span>
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
                    <input
                      className="exact-input"
                      inputMode={decimalsOf(form.currency) === 0 ? 'numeric' : 'decimal'}
                      value={form.payerAmounts[m.id] ?? ''}
                      onChange={(e) => set({ payerAmounts: { ...form.payerAmounts, [m.id]: e.target.value } })}
                      placeholder="0"
                      aria-label={`${m.displayName} 付的金額`}
                    />
                  </li>
                ))}
              </ul>
            ) : (
              <select value={form.payerId} onChange={(e) => set({ payerId: e.target.value })}>
                {members.map((m) => (
                  <option key={m.id} value={m.id}>
                    {m.displayName}
                    {m.id === view.meMemberId ? '（我）' : ''}
                  </option>
                ))}
              </select>
            )}
            {!validation.ok && validation.field === 'payers' && (showErrors || form.amount !== '') && (
              <p className="error">{validation.error}</p>
            )}
          </div>
        </section>

        <section className="card form">
          <div className="segmented" role="tablist">
            {SPLIT_TABS.map((t) => (
              <button
                key={t.type}
                type="button"
                role="tab"
                aria-selected={form.splitType === t.type}
                className={form.splitType === t.type ? 'active' : ''}
                onClick={() => set({ splitType: t.type })}
              >
                {t.label}
              </button>
            ))}
          </div>

          {form.splitType === 'equal' && (
            <button
              type="button"
              className="link-button"
              onClick={() => set({ equalIds: allSelected ? [] : members.map((m) => m.id) })}
            >
              {allSelected ? '全部取消' : '全選'}
            </button>
          )}

          <ul className="list">
            {members.map((m) => {
              const share = shareOf.get(m.id);
              return (
                <li key={m.id} className="split-row">
                  {form.splitType === 'equal' ? (
                    <label className="split-label">
                      <input type="checkbox" checked={form.equalIds.includes(m.id)} onChange={() => toggle(m.id)} />
                      <Avatar member={m} size={28} />
                      <span>{m.displayName}</span>
                    </label>
                  ) : (
                    <span className="split-label">
                      <Avatar member={m} size={28} />
                      <span>{m.displayName}</span>
                    </span>
                  )}

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
                    <input
                      className="exact-input"
                      inputMode={decimalsOf(form.currency) === 0 ? 'numeric' : 'decimal'}
                      value={form.exact[m.id] ?? ''}
                      onChange={(e) => set({ exact: { ...form.exact, [m.id]: e.target.value } })}
                      placeholder="0"
                      aria-label={`${m.displayName} 的金額`}
                    />
                  )}
                  <span className="split-share">{share ? formatMoney(share.shareMinor, form.currency) : '—'}</span>
                </li>
              );
            })}
          </ul>
          {!validation.ok && validation.field !== 'payers' && (showErrors || form.amount !== '') && (
            <p className="error">{validation.error}</p>
          )}
        </section>
      </fieldset>

      {existing && !readOnly && (
        <button type="button" className="button danger block" onClick={remove} disabled={busy}>
          刪除這筆支出
        </button>
      )}

      {!readOnly && (
        <footer className="sticky-footer">
          <button type="button" className="button primary block" onClick={save} disabled={busy}>
            {busy ? '儲存中…' : '儲存'}
          </button>
        </footer>
      )}
    </main>
  );
}
