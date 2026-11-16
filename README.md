# PIXEL DEX 像素圖鑑

紅白機像素風的寶可夢資料查詢網頁。Node.js（Express）跑在 port 3000，資料來自 [PokeAPI](https://pokeapi.co/)；
另外留好兩個串接口：**OpenAI**（AI 解說）與 **n8n Webhook**（附一份可直接匯入的 n8n flow），用哪一個由 `.env` 決定，網頁上沒有切換或設定畫面。

## 功能

- **模糊搜尋**：中文（繁／簡）、英文、日文（平假名也行）、編號都能查，打錯字也找得到
  `picachu`、`pikachuu`、`妙娃種子`、`耿龜`、`ぴかちゅう`、`#25`、`025` 都會找到正確的那隻
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
│   └─ integrations.js     OpenAI（Chat Completions）、n8n Webhook
├─ public/                 前端（純 HTML/CSS/JS，不用打包）
│   ├─ index.html、style.css
│   └─ js/ui.js（共用元件：toast、狀態畫面、面板格子、分段按鈕、打字機）、js/app.js
├─ n8n/
│   ├─ pokedex-webhook.json   ← 匯入 n8n 用的 flow
│   └─ build-workflow.js      產生上面那個 JSON（Code 節點的程式寫在這裡）
├─ test/fuzzy.test.js      npm test
└─ .env.example            複製成 .env 填 OpenAI / n8n
```

## API

| 方法 | 路徑 | 說明 |
|---|---|---|
| GET | `/api/status` | 名稱索引狀態、目前啟用的串接（`ask`: `openai`／`n8n`／`null`） |
| GET | `/api/search?q=皮卡&limit=12` | 模糊搜尋，回傳排序好的清單（含 `score`） |
| GET | `/api/pokemon/:key` | 單隻完整資料；`key` 可以是編號、英文 slug 或任何模糊字串（會回 `resolvedFrom`） |
| GET | `/api/random` | 隨機一個編號 |
| POST | `/api/ask` | `{ "id": 25, "text": "牠怕什麼？" }` → `{ text }`；依 `.env` 轉給 OpenAI 或 n8n |

`/api/ask` 每 IP 每分鐘 10 次（避免外流的網址被拿去刷 API key）。

## 串接用哪一個：`.env` 決定

| `ASK_PROVIDER` | 結果 |
|---|---|
| 留空（預設） | 有 `OPENAI_API_KEY` 用 OpenAI；否則有 `N8N_WEBHOOK_URL` 用 n8n；都沒有就不顯示串接區 |
| `openai` | 只用 OpenAI（沒填金鑰就不顯示） |
| `n8n` | 只用 n8n（沒填網址就不顯示） |
| `off` | 關掉串接區 |

網頁不提供切換或設定畫面；改 `.env` 後重啟伺服器即可。右上角會多一顆燈顯示目前用的是 OpenAI 還是 n8n。

## 串 OpenAI

1. 複製 `.env.example` 成 `.env`
2. 填 `OPENAI_API_KEY=sk-...`（模型預設 `gpt-4o-mini`，可用 `OPENAI_MODEL` 換）
3. 重啟 `npm start`，網頁下方出現「AI 解說」區塊

送出去的只有這隻寶可夢的摘要（名稱、屬性、種族值、特性、弱點、圖鑑說明、進化），不會送整包資料。
金鑰只放在伺服器端，瀏覽器看不到。

## 串 n8n

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

同時有 OpenAI 金鑰的話，再加一行 `ASK_PROVIDER=n8n`。重啟後網頁下方出現「n8n」區塊，按「送出」就會打到這個 webhook，畫面顯示回傳的 `text`。

不經網頁直接測 flow（PowerShell）：

```powershell
Invoke-RestMethod -Method Post -Uri http://localhost:5678/webhook/pokedex -ContentType 'application/json' -Body '{"name":"pikachu","message":"hello"}'
```

### 3. 改 flow

Code 節點的程式寫在 `n8n/build-workflow.js` 的 `cardCode()`／`notFoundCode()`。改完執行：

```bash
node n8n/build-workflow.js
```

會重新產生 `pokedex-webhook.json`，再匯入一次即可。想在 n8n 裡加 AI，就在「組合圖鑑卡」後面接 OpenAI 節點，把結果放進回傳的 `text`；
要通知 LINE／Discord、寫 Google Sheets 也是接在同一個位置。

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
