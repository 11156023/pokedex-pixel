// 紅白機像素風寶可夢圖鑑 — Node.js + Express，預設 port 3000
import express from 'express';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { search, getPokemon, randomId, ensureIndex, indexStatus, summarize, HttpError } from './lib/pokeapi.js';
import { integrationStatus, chat } from './lib/integrations.js';
import { loadEnv } from './lib/env.js';

const ROOT = path.dirname(fileURLToPath(import.meta.url));
// 沒有 .env 也能跑（只是 AI／n8n 未啟用）；lib 都是呼叫時才讀 env，所以這裡載入就好
const envFile = path.join(ROOT, '.env');
const envResult = loadEnv(envFile);

const app = express();
const argPort = process.argv.indexOf('--port');
const PORT = Number(argPort > 0 ? process.argv[argPort + 1] : process.env.PORT) || 3000;

app.disable('x-powered-by');
app.use(express.json({ limit: '100kb' })); // AI 建議討論會帶最近 12 則對話
app.use(express.static(path.join(ROOT, 'public'), { extensions: ['html'] }));

/* 簡單的每 IP 限流：AI 與 n8n 會花錢或打外部服務 */
const hits = new Map();
function rateLimit(max, windowMs) {
  return (req, res, next) => {
    const key = `${req.path}|${req.ip}`;
    const now = Date.now();
    const list = (hits.get(key) || []).filter((t) => now - t < windowMs);
    if (list.length >= max) return res.status(429).json({ error: '太頻繁了，稍等一下再試' });
    list.push(now);
    hits.set(key, list);
    next();
  };
}

app.get('/api/status', (req, res) => {
  res.json({ pokeapi: indexStatus(), ...integrationStatus() });
});

app.get('/api/search', async (req, res) => {
  const q = String(req.query.q || '').slice(0, 40);
  const limit = Math.min(30, Math.max(1, Number(req.query.limit) || 12));
  res.json({ q, results: await search(q, limit) });
});

app.get('/api/random', async (req, res) => {
  res.json({ id: await randomId() });
});

app.get('/api/pokemon/:key', async (req, res) => {
  res.json(await getPokemon(req.params.key.slice(0, 40)));
});

// AI 建議討論：{ id, sessionId, messages: [{ role, content, pokemon: { name } }] } → { text, provider }
// id 是目前在看的那隻：伺服器自己查 PokeAPI 資料放進提示（不信任瀏覽器送來的資料）
// sessionId：每個瀏覽器每天一個，n8n 模式給 Memory 節點用；OpenAI 或 n8n 由 .env 的 AI_PROVIDER 決定
app.post('/api/chat', rateLimit(20, 60_000), async (req, res) => {
  const { id, messages, sessionId } = req.body || {};
  const d = await getPokemon(id);
  res.json(await chat(summarize(d), messages, sessionId));
});

app.use('/api', (req, res) => res.status(404).json({ error: '沒有這個 API' }));

// Express 5 會把 async route 丟出的錯誤送到這裡
app.use((err, req, res, next) => {
  const status = err instanceof HttpError ? err.status : err.status || 500;
  if (status >= 500) console.error(`[${req.method} ${req.path}]`, err.message);
  res.status(status).json({ error: status === 500 ? '伺服器錯誤：' + err.message : err.message });
});

const server = app.listen(PORT, () => {
  console.log(`▶ POKéDEX PIXEL 已啟動：http://localhost:${PORT}`);
  const envLabel = {
    builtin: `已讀取 ${envFile}`,
    fallback: `已讀取 ${envFile}（Node ${process.versions.node} 沒有內建 loadEnvFile，用備援方式讀）`,
    missing: `找不到 ${envFile}（照 .env.example 複製一份再填）`,
    error: `讀取 ${envFile} 失敗：${envResult.error}`,
  }[envResult.how];
  console.log(`  設定檔：${envLabel}`);
  ensureIndex()
    .then((idx) => console.log(`  名稱索引就緒：${idx.entries.length} 筆（來源 ${idx.source}）`))
    .catch((err) => console.warn('  名稱索引暫時載入失敗，第一次搜尋時會再試：', err.message));
  const st = integrationStatus();
  const want = (process.env.AI_PROVIDER || '').trim().toLowerCase();
  const why =
    want === 'off' ? 'AI_PROVIDER=off'
    : want === 'n8n' ? 'AI_PROVIDER=n8n 但 N8N_CHAT_WEBHOOK_URL 是空的'
    : want === 'openai' ? 'AI_PROVIDER=openai 但 OPENAI_API_KEY 是空的'
    : '.env 的 OPENAI_API_KEY 和 N8N_CHAT_WEBHOOK_URL 都沒填';
  const chatLabel = {
    openai: `OpenAI（${st.model}；記憶在瀏覽器，帶今天最近的對話）`,
    n8n: `n8n（${process.env.N8N_CHAT_WEBHOOK_URL.trim()}；記憶在 n8n 的 Memory 節點）`,
  }[st.chat] || `未啟用（${why}）`;
  console.log(`  AI 建議討論：${chatLabel}`);
  if ((process.env.N8N_CHAT_WEBHOOK_URL || '').includes('/webhook-test/')) {
    console.warn('  ⚠ N8N_CHAT_WEBHOOK_URL 是測試網址（/webhook-test/）：n8n 要先按「Listen for test event」，而且只收一次。正式用請把 workflow 設成 Active，改用 /webhook/');
  }
  if ((process.env.N8N_WEBHOOK_URL || '').trim()) {
    console.log('  （N8N_WEBHOOK_URL 是舊的 n8n 圖鑑卡設定，已經拿掉了，可以從 .env 刪除）');
  }
});

server.on('error', (err) => {
  if (err.code === 'EADDRINUSE') {
    console.error(`✖ port ${PORT} 已被佔用。關掉佔用的程式，或換 port：PowerShell 執行  $env:PORT=3001; npm start`);
    process.exit(1);
  }
  throw err;
});
