// 外部串接：OpenAI（Chat Completions）與 n8n Webhook。
// 用哪一個完全由 .env 決定（ASK_PROVIDER），網頁只負責顯示；兩個都沒設定時網頁不顯示串接區。
import { HttpError } from './pokeapi.js';

const env = (k, d = '') => (process.env[k] ?? d).trim();

/** ASK_PROVIDER=openai | n8n | off；留空＝自動（有 OpenAI 金鑰用 OpenAI，否則有 n8n 網址用 n8n） */
export function askProvider() {
  const want = env('ASK_PROVIDER').toLowerCase();
  const hasOpenai = Boolean(env('OPENAI_API_KEY'));
  const hasN8n = Boolean(env('N8N_WEBHOOK_URL'));
  if (want === 'off') return null;
  if (want === 'openai') return hasOpenai ? 'openai' : null;
  if (want === 'n8n') return hasN8n ? 'n8n' : null;
  return hasOpenai ? 'openai' : hasN8n ? 'n8n' : null;
}

export function integrationStatus() {
  const provider = askProvider();
  return {
    ask: provider,
    model: provider === 'openai' ? env('OPENAI_MODEL', 'gpt-4o-mini') : null,
  };
}

/** 依 ASK_PROVIDER 轉給 OpenAI 或 n8n，回傳 { text } */
export async function ask(summary, text) {
  const provider = askProvider();
  if (provider === 'openai') return askOpenAI(summary, text);
  if (provider === 'n8n') return callN8n(summary, text);
  throw new HttpError(503, '沒有啟用串接（.env 的 ASK_PROVIDER／OPENAI_API_KEY／N8N_WEBHOOK_URL）');
}

const SYSTEM_PROMPT = [
  '你是紅白機時代的寶可夢圖鑑解說員，一律用繁體中文（台灣用語）回答。',
  '語氣像 8-bit 遊戲的對話框：句子短、分 2～4 段、每段一兩句。',
  '只根據提供的圖鑑資料與一般寶可夢知識回答；不確定的事就說不確定，不要編造數據。',
].join('\n');

export async function askOpenAI(summary, question) {
  const key = env('OPENAI_API_KEY');
  if (!key) throw new HttpError(503, '尚未設定 OPENAI_API_KEY（見 README「串 OpenAI」）');
  const base = env('OPENAI_BASE_URL', 'https://api.openai.com/v1').replace(/\/+$/, '');
  const model = env('OPENAI_MODEL', 'gpt-4o-mini');
  const ask = question || '請用 120 字內介紹這隻寶可夢的特色，最後給一個對戰小建議。';

  const res = await fetch(`${base}/chat/completions`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${key}` },
    body: JSON.stringify({
      model,
      messages: [
        { role: 'system', content: SYSTEM_PROMPT },
        { role: 'user', content: `圖鑑資料（JSON）：\n${JSON.stringify(summary)}\n\n問題：${ask}` },
      ],
    }),
    signal: AbortSignal.timeout(45000),
  }).catch((err) => {
    throw new HttpError(502, `連不到 OpenAI：${err.message}`);
  });

  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new HttpError(502, `OpenAI 回應 ${res.status}：${body?.error?.message || '未知錯誤'}`);
  const text = body?.choices?.[0]?.message?.content?.trim();
  if (!text) throw new HttpError(502, 'OpenAI 沒有回傳內容');
  return { text };
}

export async function callN8n(summary, message) {
  const url = env('N8N_WEBHOOK_URL');
  if (!url) throw new HttpError(503, '尚未設定 N8N_WEBHOOK_URL（見 README「串 n8n」）');

  const payload = {
    event: 'pokedex.lookup',
    id: summary.id,
    name: summary.slug, // n8n flow 用這個查 PokeAPI
    message: message || '',
    pokemon: summary,
    sentAt: new Date().toISOString(),
  };
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(payload),
    signal: AbortSignal.timeout(30000),
  }).catch((err) => {
    throw new HttpError(502, `連不到 n8n：${err.message}`);
  });

  const raw = await res.text();
  let data = null;
  try {
    data = JSON.parse(raw);
  } catch {
    /* n8n 也可能回純文字 */
  }
  if (data?.ok === false && data.text) throw new HttpError(404, data.text); // flow 自己回的「查無資料」
  if (!res.ok) {
    const hint =
      res.status === 404
        ? '（測試網址要先在 n8n 按「Listen for test event」，正式網址要先把 workflow 設成 Active）'
        : '';
    throw new HttpError(502, `n8n 回應 ${res.status}${hint}：${data?.message || raw.slice(0, 200)}`);
  }
  const first = Array.isArray(data) ? data[0] : data;
  return { text: first?.text || (typeof first === 'string' ? first : '') || raw || '（n8n 回傳空白）' };
}
