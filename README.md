# PIXEL DEX 像素圖鑑

紅白機像素風的寶可夢資料查詢網頁。Node.js（Express）跑在 port 3000，資料來自 [PokeAPI](https://pokeapi.co/)；
另外有 **AI 建議討論**：跟 AI 討論對戰／配隊／培育，會記得今天聊過的每一隻寶可夢。由網站直接呼叫 OpenAI，或轉給 n8n 的 AI Agent（附可直接匯入的 flow，含 Memory 節點）；有沒有開、走哪一條由 `.env` 決定，網頁上沒有切換或設定畫面。

## 功能

- **模糊搜尋**：中文（繁／簡）、英文、日文（平假名也行）、編號都能查，打錯字也找得到
  `picachu`、`pikachuu`、`妙娃種子`、`耿龜`、`ぴかちゅう`、`#25`、`025` 都會找到正確的那隻
- **AI 建議討論**（要在 `.env` 啟用）：圖鑑頁下方的對話區，按「對戰建議」「配隊建議」「培育建議」「怎麼打倒牠」或自己打字，可以接著追問；AI 會拿這頁的 PokeAPI 資料當依據。一天一段對話：前面聊皮卡丘、後面換噴火龍，AI 會一起考慮（例如配隊）
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
│   ├─ integrations.js     AI 建議討論（OpenAI Chat Completions 或 n8n）
│   └─ env.js              讀 .env（Node 20.12+ 用內建，舊版自己解析）
├─ public/                 前端（純 HTML/CSS/JS，不用打包）
│   ├─ index.html、style.css
│   └─ js/ui.js（共用元件）、js/md.js（AI 回答的 Markdown）、js/app.js
├─ n8n/
│   ├─ pokedex-chat.json      ← 匯入 n8n 用的 flow：AI 建議討論（AI Agent＋Memory；AI_PROVIDER=n8n）
│   └─ build-workflow.js      產生上面的 JSON（Code 節點的程式寫在這裡）
├─ test/                   npm test（模糊比對、AI 建議討論、.env 讀取）
└─ .env.example            複製成 .env 填 OpenAI / n8n
```

## API

| 方法 | 路徑 | 說明 |
|---|---|---|
| GET | `/api/status` | 名稱索引狀態、`chat`（AI 建議討論走 `openai`／`n8n`／`null` 沒開）、`model` |
| GET | `/api/search?q=皮卡&limit=12` | 模糊搜尋，回傳排序好的清單（含 `score`） |
| GET | `/api/pokemon/:key` | 單隻完整資料；`key` 可以是編號、英文 slug 或任何模糊字串（會回 `resolvedFrom`） |
| GET | `/api/random` | 隨機一個編號 |
| POST | `/api/chat` | `{ "id": 25, "sessionId": "…", "messages": [{ "role": "user", "content": "對戰建議", "pokemon": { "name": "皮卡丘" } }] }` → `{ text, provider }`；AI 建議討論，沒啟用回 503 |

限流（每 IP 每分鐘）：`/api/chat` 20 次，避免外流的網址被拿去刷 API key。

## AI 建議討論

圖鑑頁「進化」下面的對話區。按快捷按鈕（對戰建議／配隊建議／培育建議／怎麼打倒牠）或自己打字，AI 回答後可以接著追問；右上可以放大成全螢幕。

**記憶：一天一段對話。** 換寶可夢不會清掉，每個問題都會標上當時在看哪一隻（「（在看 皮卡丘）對戰建議」），對話裡也會插一條「── 噴火龍 ──」分隔。
前面聊皮卡丘、後面看噴火龍問配隊，AI 會把皮卡丘一起考慮進去。

- 每個瀏覽器每天一個隨機 `sessionId`，對話存在這個瀏覽器的 localStorage（重新整理還在）
- 隔天自動重新開始；「↺ 清除」也會換新的 `sessionId`（AI 一起忘掉）

```
瀏覽器：{ id: 目前在看的那隻, sessionId, messages: 今天的對話（每則帶 pokemon） }
  → 伺服器：自己查目前這隻的 PokeAPI 資料（屬性、種族值、特性、弱點、進化…），組成系統提示
           「以這份資料為準，不要自己編數字；今天前面聊過的寶可夢要一起考慮」
  → AI_PROVIDER=openai：直接呼叫 Chat Completions，帶今天最近 20 則對話（記憶在瀏覽器）
    AI_PROVIDER=n8n   ：POST 給 n8n 的 AI Agent，只帶這次的問題＋sessionId（記憶在 n8n 的 Memory 節點）
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
     → 整理對話   Code：取出 sessionId、這次的問題、網站給的 system
     → AI Agent   ← OpenAI Chat Model（接你的模型）
                  ← Simple Memory（Session Key＝sessionId：每個瀏覽器每天一段，記最近 12 來回）
     → 取出回答   Code：Agent 的 output → { ok, text }
     → 回傳回答
   AI Agent 出錯 → AI 失敗 → 回傳 502
   ```

2. 「OpenAI Chat Model」節點：Credential 新增 **OpenAI**（API Key；自架或相容 OpenAI 格式的服務，Base URL 填 `https://你的服務/v1`）
3. 同一個節點：Model 選 **By ID** 打模型名稱（預設 `gpt-4o-mini`）；推理模型（gpt-oss、o 系列）可在 Options 加 **Reasoning Effort** = Low
4. 右上 **Active** 打開，複製 Production URL（`/webhook/`，不是 `/webhook-test/`），填進網站 `.env`：

   ```
   AI_PROVIDER=n8n
   N8N_CHAT_WEBHOOK_URL=http://localhost:5678/webhook/pokedex-chat
   ```

5. 重啟，「AI」燈的說明會顯示「經 n8n（含 Memory）」

**Memory 存在哪：** Simple Memory 存在 n8n 的記憶體，不用另外裝東西，但 **n8n 重開就清空**。要長久保存每天的討論，把它換成 **Postgres Chat Memory**（或 Redis／MongoDB Chat Memory），Session Key 一樣填 `{{ $json.sessionId }}`；資料表裡就是每個瀏覽器每天的完整對話。
要讓 AI 查資料、算傷害，可以在 AI Agent 底下再接 Tool 節點。

網站送進 n8n 的內容：

```json
{
  "event": "pokedex.chat",
  "sessionId": "3f2a9c1e-1b2c-4d5e-8f90-123456789abc",
  "chatInput": "（在看 噴火龍）推薦 2～3 隻能跟噴火龍互補的隊友。",
  "system": "你是寶可夢對戰與培育的顧問……目前這隻的圖鑑資料（JSON）：{…}",
  "messages": [{ "role": "user", "content": "（在看 皮卡丘）對戰建議…" }, "…今天最近 20 則（Memory 有接就用不到）"],
  "id": 6,
  "name": "charizard",
  "pokemon": { "name": "噴火龍", "types": ["火", "飛行"], "...": "摘要" },
  "sentAt": "2026-11-18T08:00:00.000Z"
}
```

n8n 要回 `{ "text": "回答" }`（`ok: false` 時網站會把 `text` 當錯誤訊息顯示）。想換別家模型節點，或在中間加記錄到 Google Sheets、通知 LINE，只要最後回傳的格式一樣就好。
改 Code 節點的程式：改 `n8n/build-workflow.js` 的 `chatPrepareCode()`／`chatReplyCode()`，再 `node n8n/build-workflow.js` 重新產生。

不經網頁直接測 flow（記憶要用同一個 sessionId 連問兩次）：

```bash
curl -X POST http://localhost:5678/webhook/pokedex-chat -H 'content-type: application/json' \
  -d '{"sessionId":"test-session-1","chatInput":"（在看 皮卡丘）對戰建議","system":"你是寶可夢顧問，用繁體中文簡短回答。"}'
```

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
