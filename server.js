// 紅白機像素風寶可夢圖鑑 — Node.js + Express，預設 port 3000
import express from 'express';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { search, getPokemon, randomId, ensureIndex, indexStatus, summarize, HttpError } from './lib/pokeapi.js';
import { integrationStatus, chat, callN8n } from './lib/integrations.js';

const ROOT = path.dirname(fileURLToPath(import.meta.url));
try {
  process.loadEnvFile(path.join(ROOT, '.env')); // Node 20.12+ 內建，不需要 dotenv；lib 都是呼叫時才讀 env
} catch {
  /* 沒有 .env 也能跑：只是 OpenAI / n8n 會顯示未設定 */
}

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

// AI 建議討論：{ id, messages: [{ role: 'user' | 'assistant', content }] } → { text, provider }
// 伺服器自己查這隻的 PokeAPI 資料放進提示（不信任瀏覽器送來的資料）；OpenAI 或 n8n 由 .env 的 AI_PROVIDER 決定
app.post('/api/chat', rateLimit(20, 60_000), async (req, res) => {
  const { id, messages } = req.body || {};
  const d = await getPokemon(id);
  res.json(await chat(summarize(d), messages));
});

// n8n Webhook（.env 填了 N8N_WEBHOOK_URL 才有）
app.post('/api/ask', rateLimit(10, 60_000), async (req, res) => {
  const { id, text } = req.body || {};
  const d = await getPokemon(id);
  res.json(await callN8n(summarize(d), String(text || '').slice(0, 300)));
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
  ensureIndex()
    .then((idx) => console.log(`  名稱索引就緒：${idx.entries.length} 筆（來源 ${idx.source}）`))
    .catch((err) => console.warn('  名稱索引暫時載入失敗，第一次搜尋時會再試：', err.message));
  const st = integrationStatus();
  const chatLabel = { openai: `OpenAI（${st.model}）`, n8n: 'n8n Webhook' }[st.chat] || '未啟用（見 .env.example 的 AI_PROVIDER）';
  console.log(`  AI 建議討論：${chatLabel}`);
  if (st.n8n) console.log('  n8n 圖鑑卡：啟用');
});

server.on('error', (err) => {
  if (err.code === 'EADDRINUSE') {
    console.error(`✖ port ${PORT} 已被佔用。關掉佔用的程式，或換 port：PowerShell 執行  $env:PORT=3001; npm start`);
    process.exit(1);
  }
  throw err;
});
