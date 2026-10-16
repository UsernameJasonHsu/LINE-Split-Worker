# LINE 分帳小幫手

在 LINE 群組裡一起記帳、自動算出「誰該付誰多少」的分帳工具。不需下載 App、不需註冊，全程在 LINE 內完成。

- **Bot**：加入群組後自動建立帳本，回應群組指令（`帳本`、`結算`、`回饋`、`說明`）
- **LIFF 記帳畫面**：在 LINE 內開啟的網頁，負責記帳、結算、統計等操作
- 參考產品：Lightsplit；適用對象：個人／小圈子自用

> 詳細的設計決策與資料模型請見 [SPEC.md](SPEC.md)。

---

## 功能

### 記帳
- **多幣別**：每筆支出可選幣別，自動帶入當日參考匯率（可手動改成刷卡匯率），匯率於記帳時鎖定
- **分攤方式**
  - 均分：勾選要分攤的人
  - 份數：依比例分攤（例如 2:1）
  - 指定金額：每人填寫各自的金額
  - 部分指定：部分成員指定金額，剩餘由勾選的人平分（同一人可同時「指定 + 平分」）
- **多人付款**：一筆支出可由多人共同支付
- **分類**：餐飲、交通、住宿、購物、娛樂、其他
- **金額計算**：金額欄位可輸入 `1200+350`、`3000/3`、`(80+120)*2`，精確計算不產生小數誤差
- **列表篩選**：搜尋項目名稱、「全部／與我有關／我付的」、依分類篩選

### 結算
- 自動計算每人淨額，並以最少轉帳次數提供建議（n 人最多 n−1 筆）
- 標記已付／復原還款紀錄
- 將結算結果發送到聊天室（以使用者身分發送，不耗用 Bot 推播額度）
- **收款資訊**：每人自行填寫轉帳帳號，顯示在建議轉帳旁並可一鍵複製；只能修改自己的

### 帳本管理
- 一個群組可依序擁有多本帳本，同時最多一本進行中
- **結束帳本**：必須全部結清後才能結束，結束後為唯讀
- **開新帳本**：可挑選要帶入的成員
- 帳本名稱與主幣別設定（有紀錄後主幣別即鎖定）

### 統計
- 總支出、各分類花費（長條圖與占比）、每人花費與代墊金額

### 意見回饋與管理（管理員）
- 使用者可送出問題回報／功能建議，並查看處理狀態與回覆
- 管理員可在回饋管理頁變更狀態、回覆，並可選擇以 Bot 私訊通知對方
- 新回饋會私訊通知管理員
- **系統用量**卡片：資料庫容量、資料筆數、LINE 本月推播用量

---

## 架構

```
群組聊天室 ──事件──▶ LINE Messaging API ──Webhook──▶ Cloudflare Worker (Hono)
     │                                                   │        │
     │                                                   │        └──▶ D1 (SQLite)
     └─ 點「打開帳本」─▶ LIFF（同一個 Worker 提供靜態檔）─ /api ─┘
```

| 元件 | 技術 | 位置 |
|---|---|---|
| 計算核心 | 純 TypeScript，無外部依賴（換匯、分攤、結算） | `packages/core` |
| 後端 | Cloudflare Workers + Hono + D1 | `apps/worker` |
| 前端 | React + Vite + LIFF SDK（由 Worker Static Assets 提供） | `apps/liff` |
| 匯率 | open.er-api.com 市場中間價，依台北日期每日快取 | `apps/worker/src/fx.ts` |

### 設計重點
- **金額一律以整數最小單位儲存**，換匯以 BigInt 精確計算，餘數以最大餘數法分配，保證加總正確
- **身分驗證**：前端送出 LIFF ID Token，後端向 LINE 驗證後取得使用者，不信任前端傳入的 userId
- **Webhook 簽章驗證**：以 Channel secret 驗證 `X-Line-Signature`
- **並發控制**：支出以隨機 `revision` 做樂觀鎖，同時編輯時後送出者會收到 409
- **訊息費用**：Bot 只使用 reply（免費）；推播僅用於回饋通知

---

## 專案結構

```
LINE-Bot/
├─ SPEC.md                    規格與設計決策
├─ packages/core/             計算核心（含測試）
├─ apps/worker/               後端
│  ├─ src/
│  │  ├─ index.ts             進入點（路由、錯誤處理）
│  │  ├─ webhook.ts           LINE Webhook 與群組指令
│  │  ├─ api.ts               LIFF 用 REST API
│  │  ├─ fx.ts                匯率
│  │  ├─ line/                LINE API、簽章、ID Token、訊息卡片
│  │  └─ services/            帳本、支出、結算、收款、回饋、用量
│  ├─ migrations/             D1 資料庫 migration（依序套用）
│  ├─ test/                   API／Webhook／migration 測試
│  └─ wrangler.jsonc          Worker 設定
└─ apps/liff/                 LIFF 前端
   ├─ src/views/              各頁面
   ├─ src/lib/                表單、計算機、篩選、統計等純邏輯
   └─ test/
```

---

## 環境需求

- Node.js 20 以上（開發時使用 Node 24）
- Cloudflare 帳號（Workers、D1 免費方案即可）
- LINE Developers 帳號：
  - **LINE 官方帳號 + Messaging API Channel**（Bot）
  - **LINE Login Channel**（LIFF 所在），狀態需為 **Published**，否則只有管理員能開啟 LIFF
  - 兩個 Channel 必須在**同一個 Provider** 底下，否則同一人的 userId 會不一致

---

## 初次設定

### 1. 安裝套件
```bash
npm install
```

### 2. LINE 設定
| 項目 | 位置 | 設定 |
|---|---|---|
| Webhook URL | Messaging API Channel → Messaging API | `https://<worker 網址>/webhook`，開啟 Use webhook |
| 允許加入群組 | 同上 | Allow bot to join group chats：Enabled |
| 自動回應 | 同上 | Auto-reply messages：Disabled |
| LIFF Endpoint URL | LINE Login Channel → LIFF | `https://<worker 網址>/` |
| LIFF Scopes | 同上 | `openid`、`profile`、`chat_message.write` |
| Share target picker | 同上 | On |

### 3. Cloudflare 設定
```bash
npx wrangler login
npx wrangler d1 create line-split          # 將 database_id 填入 apps/worker/wrangler.jsonc
```

### 4. 設定值

**非機密**（`apps/worker/wrangler.jsonc` 的 `vars`）：

| 名稱 | 說明 |
|---|---|
| `LINE_LOGIN_CHANNEL_ID` | LINE Login Channel 的 Channel ID（即 LIFF ID 的前半段） |
| `LIFF_ID` | LIFF ID |
| `ADMIN_LINE_USER_IDS` | 回饋管理員的 LINE userId，多位以逗號分隔 |
| `FEEDBACK_PUSH` | `on`：新回饋私訊通知管理員；`off`：不通知 |

前端的 LIFF ID 設定在 `apps/liff/.env`（`VITE_LIFF_ID`）。

**機密**（不進版控）：複製 `apps/worker/.dev.vars.example` 為 `apps/worker/.dev.vars` 並填入：

| 名稱 | 來源 |
|---|---|
| `LINE_CHANNEL_SECRET` | Messaging API Channel → Basic settings → Channel secret |
| `LINE_CHANNEL_ACCESS_TOKEN` | Messaging API Channel → Messaging API → Channel access token |

上傳到 Cloudflare：
```bash
cd apps/worker
npx wrangler secret bulk .dev.vars
```

> ⚠️ 注意：LINE Login Channel 也有一個 Channel secret，**不是**這裡要用的那個。

### 5. 建立資料表並部署
```bash
npm run db:migrate:remote -w @line-split/worker
npm run deploy
```

---

## 開發

```bash
npm test             # 執行所有測試（core / worker / liff）
npm run typecheck    # 型別檢查
npm run build        # 打包 LIFF 前端
```

- Worker 測試透過 `wrangler` 的 `getPlatformProxy` 在本機啟動 D1，外部 API（LINE、匯率）以假資料替代，不會打到真實服務
- 本機啟動 API：`npm run dev -w @line-split/worker`（需先 `npm run db:migrate:local -w @line-split/worker`）
- LIFF 需要 LINE 登入，實際畫面請部署後在 LINE App 中測試

### 資料庫 migration
1. 在 `apps/worker/migrations/` 新增下一個編號的 `.sql` 檔
2. 執行測試（測試會套用全部 migration）
3. 正式環境先套用 migration，再部署程式：
   ```bash
   npm run db:migrate:remote -w @line-split/worker
   npm run deploy
   ```
4. 修改既有資料表結構前，建議先備份：
   ```bash
   npx wrangler d1 export line-split --remote --output backup.sql
   ```

---

## 部署

```bash
npm run deploy
```

會先打包 LIFF 前端，再部署 Worker（前端靜態檔與 API 一起上傳）。部署後可用以下方式確認：

```bash
curl https://<worker 網址>/health      # 應回傳 {"ok":true}
```

---

## 群組指令

| 指令 | 說明 |
|---|---|
| `帳本`／`記帳` | 取得記帳連結；若目前沒有進行中的帳本，會提供開新帳本的按鈕 |
| `結算` | 顯示目前帳本的結算結果 |
| `回饋`／`意見回饋` | 取得意見回饋頁面連結 |
| `說明`／`help` | 顯示指令說明 |

---

## 用量與費用

以下皆以免費方案為準，實際額度以各服務官網公告為準：

| 項目 | 免費額度 | 備註 |
|---|---|---|
| Cloudflare Workers | 每日 10 萬次請求 | |
| Cloudflare D1 | 單一資料庫 500 MB | 讀寫列數另有每日上限 |
| LINE 推播訊息 | 依官方帳號方案（目前 200 則／月） | 只有回饋通知會用到推播 |

管理員可在 LIFF 的「回饋管理」頁查看系統用量。

---

## 規劃中

- **拍收據自動填入**：拍照後以視覺 AI 模型辨識店名、總額、幣別、日期並帶入表單（設計已討論，暫緩）
- 帳本預設幣別、修改紀錄頁、非 LINE 成員、群組打字記帳、匯出 CSV
- 測試環境（staging）與 GitHub Actions 自動化測試／部署

---

## 授權條款

本專案採用 [MIT License](LICENSE) 授權，Copyright (c) 2026 Ryan Hsu。

可自由使用、修改、散布及商業使用，但須保留版權聲明與授權條款全文。本軟體依「現狀」提供，不附帶任何擔保。

使用的第三方服務（LINE Platform、Cloudflare、open.er-api.com）各自受其服務條款規範。
