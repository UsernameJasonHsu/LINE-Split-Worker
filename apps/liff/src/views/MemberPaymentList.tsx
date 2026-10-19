import { useState } from 'react';
import { errorMessage } from '../api';
import type { ViewProps } from '../App';
import { Avatar } from '../components';
import { PaymentInfoLines } from '../PaymentInfoLines';

/**
 * Every member's payment details. Each person can only edit their own, and
 * only after tapping 編輯, so saved details are not changed by accident.
 */
export function MemberPaymentList({ api, data, reload, notify }: ViewProps) {
  const { members, meMemberId } = data.view;
  const me = members.find((m) => m.id === meMemberId);
  const [draft, setDraft] = useState<string | null>(null); // null = not editing
  const [busy, setBusy] = useState(false);

  // Me first, then everyone else in member order.
  const ordered = me ? [me, ...members.filter((m) => m.id !== meMemberId)] : members;

  async function save() {
    if (draft === null) return;
    setBusy(true);
    try {
      const saved = await api.setMyPaymentInfo(draft);
      await reload();
      setDraft(null);
      notify(saved ? '已儲存收款資訊' : '已清除收款資訊');
    } catch (err) {
      notify(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="card">
      <ul className="list">
        {ordered.map((m) => {
          const isMe = m.id === meMemberId;
          const editing = isMe && draft !== null;
          return (
            <li key={m.id} className="payment-row">
              <Avatar member={m} size={28} />
              <div className="list-main">
                <span className="payment-name">
                  {m.displayName}
                  {isMe && '（我）'}
                </span>
                {editing ? (
                  <>
                    <textarea
                      value={draft}
                      onChange={(e) => setDraft(e.target.value)}
                      placeholder={'例如：\n中國信託 (822) 1234-5678-9012\nLINE Pay：0912-345-678'}
                      maxLength={200}
                      rows={3}
                      autoFocus
                    />
                    <span className="button-pair">
                      <button type="button" className="button small" disabled={busy} onClick={() => setDraft(null)}>
                        取消
                      </button>
                      <button
                        type="button"
                        className="button primary small"
                        disabled={busy || draft.trim() === (m.paymentInfo ?? '')}
                        onClick={save}
                      >
                        {busy ? '儲存中…' : '儲存'}
                      </button>
                    </span>
                  </>
                ) : m.paymentInfo ? (
                  <PaymentInfoLines info={m.paymentInfo} notify={notify} className="payment-text" />
                ) : (
                  <span className="muted small">尚未提供</span>
                )}
              </div>
              {!editing && (
                <span className="row-actions">
                  {isMe && (
                    <button type="button" className="link-button small" onClick={() => setDraft(m.paymentInfo ?? '')}>
                      {m.paymentInfo ? '編輯' : '填寫'}
                    </button>
                  )}
                </span>
              )}
            </li>
          );
        })}
      </ul>
      <p className="muted small hint">
        每個人只能填寫、修改自己的收款資訊，填一次會套用到你參與的所有帳本，只有同帳本的成員看得到。名單上沒有的朋友，請他在群組點「打開帳本」加入後自己填寫。
      </p>
    </section>
  );
}
