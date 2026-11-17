# PIXEL DEX 像素圖鑑

紅白機像素風的寶可夢資料查詢網頁。Node.js（Express）跑在 port 3000，資料來自 [PokeAPI](https://pokeapi.co/)；
另外留好兩個串接口：**AI 建議討論**（針對目前這隻寶可夢跟 AI 討論對戰／配隊／培育，由網站直接呼叫 OpenAI 或轉給 n8n）與 **n8n 圖鑑卡 Webhook**（兩個都附可直接匯入的 n8n flow），有沒有開、走哪一條由 `.env` 決定，網頁上沒有切換或設定畫面。

## 功能

- **模糊搜尋**：中文（繁／簡）、英文、日文（平假名也行）、編號都能查，打錯字也找得到
  `picachu`、`pikachuu`、`妙娃種子`、`耿龜`、`ぴかちゅう`、`#25`、`025` 都會找到正確的那隻
- **AI 建議討論**（要在 `.env` 啟用）：圖鑑頁下方的對話區，按「對戰建議」「配隊建議」「培育建議」「怎麼打倒牠」或自己打字，可以接著追問；AI 會拿這頁的 PokeAPI 資料當依據
- **圖鑑畫面**：點陣圖（一般／色違／背面／初代紅綠版／原畫，只做整數倍放大）、叫聲、屬性、身高體重、性別比例、世代、捕獲率、蛋群、特性（含隱藏特性與說明）
- **種族值** 6 項與總和、**屬性相性**（×4／×2／×½／×¼／×0）、**圖鑑說明**（打字機效果）、**進化鏈**（含進化條件，伊布這種分支也支援）、**形態**（超級進化、地區形態、超極巨化）
- 手機／桌機 RWD；快捷鍵 `/` 搜尋、`←` `→` 上／下一隻、`R` 隨機
- 網址會帶 `?p=pikachu`，可以直接分享或重新整理

## 快速開始

```bash
cd pokedex-pixel
npm install
npm start
```

打開 http://localhost:3000 。

port 3000 被佔用時（例如另一個 Next.js 專案在跑）可以換 port：

```bash
node server.js --port 3001
```

第一次啟動會用 PokeAPI 的 GraphQL 一次抓 1025 種、1351 筆（含形態）的中英日名稱建索引，存在 `data/index.json`，一週更新一次；刪掉這個檔就會重抓。
GraphQL 暫時掛掉時會退回 REST 清單（只有英文名），下次啟動再試。

## 專案結構

```
pokedex-pixel/
├─ server.js               Express：靜態網頁 + /api/*
├─ lib/
│   ├─ pokeapi.js          名稱索引（GraphQL）、單隻資料（REST）、快取、整理成前端要的格式
│   ├─ fuzzy.js            模糊比對（完全 > 開頭 > 包含 > 打錯字 > 依序出現）
│   ├─ typechart.js        18 屬性中文名、NES 色票、相剋表
│   └─ integrations.js     AI 建議討論（OpenAI Chat Completions 或 n8n）、n8n 圖鑑卡 Webhook
├─ public/                 前端（純 HTML/CSS/JS，不用打包）
│   ├─ index.html、style.css
│   └─ js/ui.js（共用元件：toast、狀態畫面、面板格子、分段按鈕、打字機）、js/app.js
├─ n8n/
│   ├─ pokedex-webhook.json   ← 匯入 n8n 用的 flow：圖鑑卡
│   ├─ pokedex-chat.json      ← 匯入 n8n 用的 flow：AI 建議討論（AI_PROVIDER=n8n）
│   └─ build-workflow.js      產生上面兩個 JSON（Code 節點的程式寫在這裡）
├─ test/                   npm test（fuzzy.test.js 模糊比對、chat.test.js AI 建議討論）
└─ .env.example            複製成 .env 填 OpenAI / n8n
```

## API

| 方法 | 路徑 | 說明 |
|---|---|---|
| GET | `/api/status` | 名稱索引狀態、`chat`（AI 建議討論走 `openai`／`n8n`／`null` 沒開）、`model`、`n8n`（圖鑑卡 webhook 有沒有填） |
| GET | `/api/search?q=皮卡&limit=12` | 模糊搜尋，回傳排序好的清單（含 `score`） |
| GET | `/api/pokemon/:key` | 單隻完整資料；`key` 可以是編號、英文 slug 或任何模糊字串（會回 `resolvedFrom`） |
| GET | `/api/random` | 隨機一個編號 |
| POST | `/api/chat` | `{ "id": 25, "messages": [{ "role": "user", "content": "對戰建議" }] }` → `{ text, provider }`；AI 建議討論，沒啟用回 503 |
| POST | `/api/ask` | `{ "id": 25, "text": "附帶訊息" }` → `{ text }`；轉給 n8n 圖鑑卡 Webhook |

限流（每 IP 每分鐘）：`/api/chat` 20 次、`/api/ask` 10 次，避免外流的網址被拿去刷 API key。

## AI 建議討論

圖鑑頁「進化」下面的對話區。按快捷按鈕（對戰建議／配隊建議／培育建議／怎麼打倒牠）或自己打字，AI 回答後可以接著追問；換一隻寶可夢就重新開始。

```
瀏覽器：整段對話 { id, messages }
  → 伺服器：自己查這隻的 PokeAPI 資料（屬性、種族值、特性、弱點、進化…），組成系統提示
           「以這份資料為準，不要自己編數字；200 字內、條列」，只帶最近 12 則對話
  → AI_PROVIDER=openai：直接呼叫 Chat Completions
    AI_PROVIDER=n8n   ：POST 給 n8n 的 AI flow，由 n8n 呼叫模型
  → { text } 顯示在對話區
```

圖鑑資料由伺服器查，不用瀏覽器送來的；金鑰只放在伺服器端（或 n8n 的 Credential），瀏覽器看不到。

### 用 OpenAI（網站直接呼叫）

1. 複製 `.env.example` 成 `.env`
2. 填 `OPENAI_API_KEY=sk-...`（模型預設 `gpt-4o-mini`，可用 `OPENAI_MODEL` 換；走相容 OpenAI 格式的代理或本機模型時改 `OPENAI_BASE_URL`）
3. `AI_PROVIDER` 留空或填 `openai`，重啟 `npm start`，右上角多一顆「AI」燈，圖鑑頁出現「AI 建議討論」

用 gpt-oss、o 系列這類推理模型時，可以在 `.env` 加 `OPENAI_REASONING_EFFORT=low` 讓它少想一點、回得快一點（一般模型不要填，會被拒絕）。

### 用 n8n（n8n 呼叫 AI）

1. n8n 匯入 `n8n/pokedex-chat.json`：

   ```
   Webhook (POST /pokedex-chat)
     → 整理對話   Code：最新一則當 prompt，前面的對話接在網站給的 system 後面
     → AI Agent   ← OpenAI Chat Model（接你的模型）
     → 取出回答   Code：Agent 的 output → { ok, text }
     → 回傳回答
   AI Agent 出錯 → AI 失敗 → 回傳 502
   ```

2. 「OpenAI Chat Model」節點：Credential 新增 **OpenAI**（API Key；自架或相容 OpenAI 格式的服務，Base URL 填 `https://你的服務/v1`）
3. 同一個節點：Model 選 **By ID** 打模型名稱（預設 `gpt-4o-mini`）；推理模型（gpt-oss、o 系列）可在 Options 加 **Reasoning Effort** = Low
4. 右上 **Active** 打開，複製 Production URL，填進網站 `.env`：

   ```
   AI_PROVIDER=n8n
   N8N_CHAT_WEBHOOK_URL=http://localhost:5678/webhook/pokedex-chat
   ```

5. 重啟，「AI」燈的說明會顯示「經 n8n」

網站每次都帶整段對話，所以 Agent 不用接 Memory 節點；要讓 AI 查資料、算傷害，可以在 AI Agent 底下再接 Tool 節點。

網站送進 n8n 的內容：

```json
{
  "event": "pokedex.chat",
  "id": 25,
  "name": "pikachu",
  "pokemon": { "name": "皮卡丘", "types": ["電"], "stats": { "HP": 35 }, "...": "摘要" },
  "system": "你是寶可夢對戰與培育的顧問……圖鑑資料（JSON）：{…}",
  "messages": [{ "role": "user", "content": "皮卡丘在對戰中適合當什麼角色？" }],
  "sentAt": "2026-11-17T08:00:00.000Z"
}
```

n8n 要回 `{ "text": "回答" }`（`ok: false` 時網站會把 `text` 當錯誤訊息顯示）。想換別家模型節點，或在中間加記錄到 Google Sheets、通知 LINE，只要最後回傳的格式一樣就好。
改 Code 節點的程式：改 `n8n/build-workflow.js` 的 `chatPrepareCode()`／`chatReplyCode()`，再 `node n8n/build-workflow.js` 重新產生。

## 串 n8n 圖鑑卡

### 1. 匯入 flow

n8n 編輯器 → 右上「⋯」→ **Import from File** → 選 `n8n/pokedex-webhook.json`。

```
Webhook (POST /pokedex)
  → PokeAPI 寶可夢   GET https://pokeapi.co/api/v2/pokemon/{name}
  → PokeAPI 物種     GET {species.url}
  → 組合圖鑑卡       Code：中文名、分類、屬性、種族值、最突出能力、圖鑑說明
  → 回傳圖鑑卡       Respond to Webhook（JSON）
兩個 HTTP 節點出錯 → 查無資料 → 回傳 404
```

網頁送進 n8n 的內容：

```json
{
  "event": "pokedex.lookup",
  "id": 25,
  "name": "pikachu",
  "message": "使用者在網頁輸入的附帶訊息",
  "pokemon": { "name": "皮卡丘", "types": ["電"], "stats": { "HP": 35 }, "...": "摘要" },
  "sentAt": "2026-11-16T08:00:00.000Z"
}
```

n8n 回傳（網頁只顯示 `text`；`card` 是給其他節點或程式用的結構化資料）：

```json
{ "ok": true, "source": "n8n", "text": "【No.025 皮卡丘】鼠寶可夢\n屬性：電\n…", "card": { "...": "結構化資料" } }
```

### 2. 啟用並填網址

- **正式用**：flow 右上 **Active** 打開，複製 Webhook 節點的 **Production URL**（`…/webhook/pokedex`）
- **測試用**：在 Webhook 節點按 **Listen for test event**，用 **Test URL**（`…/webhook-test/pokedex`，每按一次只收一筆）

填進 `.env`：

```
N8N_WEBHOOK_URL=http://localhost:5678/webhook/pokedex
```

重啟後網頁最下面出現「n8n 圖鑑卡」區塊，按「送出」就會打到這個 webhook，畫面顯示回傳的 `text`。（跟 AI 建議討論互不影響，可以同時開；兩個 flow 可以放在同一台 n8n。）

不經網頁直接測 flow（PowerShell）：

```powershell
Invoke-RestMethod -Method Post -Uri http://localhost:5678/webhook/pokedex -ContentType 'application/json' -Body '{"name":"pikachu","message":"hello"}'
```

### 3. 改 flow

Code 節點的程式寫在 `n8n/build-workflow.js` 的 `cardCode()`／`notFoundCode()`。改完執行：

```bash
node n8n/build-workflow.js
```

會重新產生 `pokedex-webhook.json`（和 `pokedex-chat.json`），再匯入一次即可。要讓 AI 討論這隻寶可夢，用上面的「AI 建議討論」；
圖鑑卡要通知 LINE／Discord、寫 Google Sheets，就接在「組合圖鑑卡」後面。

## 模糊搜尋怎麼算

每筆資料有多個比對 key（英文 slug、英文名、繁中、簡中、日文），先做正規化（全形轉半形、平假名轉片假名、去重音與符號），每個 key 打分取最高：

| 情況 | 分數 | 例子 |
|---|---|---|
| 完全相符 | 1000 | `pikachu` |
| 開頭相符 | 850–900 | `pika` |
| 包含 | 710–780 | `火龍` → 噴火龍 |
| 整個名字打錯 1～3 字（OSA 編輯距離，相鄰對調算 1） | 540–780 | `picachu`、`妙娃種子` |
| 字依序出現（子序列） | 450–600 | `pkchu` |
| 兩個中文字錯一個 | 480 | `耿龜` → 耿鬼 |

預設形態再 +15，所以打「皮卡丘」會先出本尊，再出各種帽子皮卡丘。
形態的英文名保留單字邊界比對，避免 `pikachuu` 被 `pikachu-unova-cap` 的開頭搶走。

## 備註

- 字型：中文用 [俐方體11號（Cubic 11）](https://github.com/ACh-K/Cubic-11)（OFL），英數用 Press Start 2P，皆從 CDN 載入
- 色票取自 NES 2C02 調色盤；頁首是紅白機機身的紅＋金，圖鑑是一整塊 NES RPG 風的黑底白框面板
- 版面：面板內用同一條 5：7 欄線分格（點陣圖｜名字＋說明＋基本資料、屬性相性｜種族值），同排左右等高、分隔線上下對齊；860px 以下改成一欄
- 叫聲是 `.ogg`，部分 Safari 不能播
- 第 9 世代有些寶可夢 PokeAPI 還沒有中文圖鑑說明，會改顯示英文並標註
