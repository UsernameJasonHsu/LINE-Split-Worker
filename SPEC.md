# LINE 群組分帳工具 — 規格

## 目標

在 LINE 群組內記錄共同支出，自動算出「誰該付誰多少」。不需下載 App、不需另外註冊，全程在 LINE 內完成（LIFF 於 LINE 內建瀏覽器開啟）。

- 使用對象：個人／小圈子自用（未認證官方帳號、免費方案）
- 參考產品：Lightsplit

## 架構

```
群組聊天室 ──事件──▶ Messaging API ──Webhook──▶ Cloudflare Worker (Hono) ──▶ D1 (SQLite)
     │                                                ▲
     └─ 點連結 ─▶ LIFF App（同一個 Worker 的 Static Assets）─ /api + ID Token ─┘
```

| 元件 | 技術 |
|---|---|
| 計算核心 | `packages/core`：純 TypeScript、無外部依賴、Vitest |
| 後端 | `apps/worker`：Cloudflare Workers + Hono + D1（原生 SQL，migrations 於 `apps/worker/migrations`） |
| 前端 | `apps/liff`：React + Vite + `@line/liff`，由 Worker Static Assets 提供（同網域，免 CORS） |
| 匯率 | open.er-api.com 市場中間價，使用時抓取並依台北日期每日快取於 `fx_rates`；可手動覆寫（如信用卡帳單匯率）。臺銀網站有反爬蟲驗證，不採用 |

### 關鍵設計決策

- **群組 ↔ 帳本綁定**：`liff.getContext()` 不再提供 `groupId`。Bot 收到 `join` 事件時建立帳本，於群組回覆 `https://liff.line.me/{liffId}?l={ledgerId}`；成員一律由此連結進入。
- **同一 Provider**：Messaging API Channel 與 LINE Login Channel 必須同屬一個 Provider，否則同一人的 userId 不一致。
- **身分驗證**：前端送 `liff.getIDToken()`，後端驗證後取 `sub` 為 userId；不信任前端傳入的 userId。
- **訊息費用**：Bot 只用 reply（免費），不主動 push。分享結算到群組使用 `liff.shareTargetPicker`（以使用者身分發送，不耗額度）。
- **Workers 相容**：不用 `@line/bot-sdk`，以 `fetch` 呼叫 REST API、WebCrypto 驗證 Webhook 簽章。

## 金額與多幣別規則

- 金額一律以**整數最小單位**（`minor`）儲存；不使用浮點數。
- 幣別小數位採實務慣例（TWD、JPY、KRW、VND、IDR = 0；其餘多為 2），見 `packages/core/src/currency.ts`。
- 每個帳本有一個**主幣別**（預設 TWD），結算一律以主幣別計算。
- 每筆支出儲存：原幣別、原幣金額、匯率快照（十進位字串，如 `"0.2153"` 表示 1 單位原幣 = 0.2153 主幣）、主幣金額。匯率於記帳時鎖定。
- 換算：`主幣 minor = round(原幣 minor × 匯率 × 10^(主幣小數位 − 原幣小數位))`，四捨五入（half away from zero）。
- 分攤：先以**原幣**分攤，再將主幣總額依原幣分攤比例分配，保證主幣各份加總 = 主幣總額。
- 餘數分配：最大餘數法；餘數相同時依輸入順序（較前者優先）。

## 並發控制

`expenses.revision` 為隨機字串。更新時以單一 D1 batch（交易）執行：先以舊 revision 條件更新表頭並寫入新 revision，其後刪除／重建明細與寫入 audit 的語句都以「新 revision 存在」為條件；舊 revision 不符時整批不生效，回傳 409。

## 結算

1. 淨額 `balance = 已付 − 應攤 + 已付出還款 − 已收到還款`，全體加總恆為 0。
2. 貪婪配對：每次取欠最多者與被欠最多者，轉帳金額為兩者較小值，直到全部歸零。轉帳筆數 ≤ n − 1。
3. 平手時依 memberId 字典序，確保結果穩定。

## 資料模型（D1）

```
ledgers         (id, line_group_id UNIQUE NULL, name, base_currency, created_at, archived_at)
members         (id, ledger_id, line_user_id NULL, display_name, avatar_url, is_virtual, joined_at)
expenses        (id, ledger_id, title, currency, amount_minor, fx_rate, fx_source, base_amount_minor,
                 split_type, category, spent_at, created_by, created_at, updated_at, revision, deleted_at)
expense_payers  (expense_id, member_id, amount_minor, base_amount_minor)
expense_shares  (expense_id, member_id, split_value, share_minor, base_share_minor)
settlements     (id, ledger_id, from_member, to_member, amount_minor, settled_at, created_by, created_at, deleted_at)
                -- amount_minor 為主幣別；有支出或還款後主幣別即鎖定
fx_rates        (date, from_currency, to_currency, rate, source, fetched_at)
audit_logs      (id, ledger_id, actor_member_id, action, entity, before_json, after_json, at)
```

## 功能範圍

| 優先級 | 功能 |
|---|---|
| P0 | Bot 入群建帳本、成員加入、支出 CRUD、均分、多幣別（臺銀匯率＋手動）、結算建議、標記已付、群組指令「結算」回覆摘要 |
| P1 | 依金額／比例／份數分攤、多人付款、依原幣別分開結算、修改紀錄、分類 |
| P2 | 收據 OCR、匯出 CSV、虛擬成員 |
| 保留 | 群組打字記帳（如 `午餐 450 我付 平分`） |

## 機密設定

`LINE_CHANNEL_SECRET`、`LINE_CHANNEL_ACCESS_TOKEN` 放在本機 `.dev.vars`（不進版控）與 `wrangler secret`。`LINE_LOGIN_CHANNEL_ID`、`LIFF_ID` 非機密。
