// 外部串接：OpenAI（AI 判斷模糊查詢）與 n8n Webhook。都由 .env 決定，網頁只負責顯示。
//  - OPENAI_API_KEY 有填 → 搜尋框在名稱比對不到時交給 AI 判斷（「黃色老鼠」→ 皮卡丘）
//  - N8N_WEBHOOK_URL 有填 → 圖鑑頁下方出現 n8n 區塊
import { HttpError } from './pokeapi.js';
import { candidateLine } from './describe.js';

const env = (k, d = '') => (process.env[k] ?? d).trim();

export const aiSearchEnabled = () => Boolean(env('OPENAI_API_KEY'));
export const n8nEnabled = () => Boolean(env('N8N_WEBHOOK_URL'));

export function integrationStatus() {
  return {
    aiSearch: aiSearchEnabled(),
    model: aiSearchEnabled() ? env('OPENAI_MODEL', 'gpt-4o-mini') : null,
    n8n: n8nEnabled(),
  };
}

/* ---------- AI 判斷模糊查詢 ---------- */
export const AI_TOP_N = 15; // 固定輸出幾名
// AI 只挑前幾名，其餘由本機候選依分數補：叫它挑 15 隻回覆變 3 倍長，常超過 20 秒、後半段也容易變亂碼
export const AI_PICKS = 5;

function searchPrompt(candidates) {
  const lines = candidates.map(candidateLine).join('\n');
  return [
    '你是寶可夢圖鑑的搜尋助手。使用者輸入的是「描述」而不是正確名稱，例如外觀、顏色、動物原型、屬性、外號、錯得很離譜的名字。',
    `請找出最符合的前 ${AI_PICKS} 名寶可夢（正式編號 1～1025），一定列滿 ${AI_PICKS} 隻，最可能的排第一。`,
    lines
      ? '下面的候選清單是從 PokeAPI 圖鑑資料依描述的顏色／屬性／分類／名字篩出來的，格式「編號 名稱|顏色|屬性|分類」。優先從清單挑，編號和名稱照清單抄；清單外如果有你確定更符合的，也可以列。'
      : '這次沒有候選清單，請依你對寶可夢的知識判斷。',
    // 範例只放欄位說明，不放真的寶可夢，免得模型照抄範例的理由
    '只回傳 JSON，不要其他文字：{"matches":[{"dexNo":編號,"name":"繁中官方名","en":"英文官方名","reason":"為什麼符合"}]}',
    'reason 用繁體中文（台灣用語），12 字以內，說出這隻跟描述哪裡相符。完全找不到就回 {"matches":[]}。',
    lines ? `\n候選清單：\n${lines}` : '',
  ].join('\n');
}

/** 整份 JSON 解析失敗時，一筆一筆撿還能讀的 {...}（模型輸出中途變亂碼、或被截斷） */
function salvageObjects(text) {
  const out = [];
  for (const m of text.matchAll(/\{[^{}]*\}/g)) {
    try {
      out.push(JSON.parse(m[0]));
    } catch {
      /* 這筆壞了就跳過 */
    }
  }
  return out;
}

/** 從模型回覆裡挖出 matches（容忍 ```json 區塊、前後多餘文字、部分亂碼） */
export function parseAiPicks(content) {
  const text = String(content || '').replace(/```(?:json)?/gi, '');
  const start = text.search(/[[{]/);
  if (start < 0) return [];
  const end = text.lastIndexOf(text[start] === '[' ? ']' : '}');
  let list;
  try {
    if (end <= start) throw new Error('沒有結尾');
    const data = JSON.parse(text.slice(start, end + 1));
    list = Array.isArray(data) ? data : Array.isArray(data?.matches) ? data.matches : [];
  } catch {
    list = salvageObjects(text.slice(start));
  }
  return list
    .filter((m) => m && typeof m === 'object')
    .map((m) => ({
      dexNo: Number.isInteger(Number(m.dexNo)) ? Number(m.dexNo) : 0,
      name: String(m.name || '').trim().slice(0, 60),
      en: String(m.en || '').trim().slice(0, 60),
      reason: String(m.reason || '').trim().slice(0, 40),
    }))
    .filter((m) => m.name || m.en || m.dexNo)
    .slice(0, AI_PICKS);
}

const aiCache = new Map(); // 查詢字 → { at, picks }；同一個描述不重複花 API
const AI_CACHE_TTL = 24 * 60 * 60 * 1000;
const AI_CACHE_MAX = 300;

/**
 * candidates：本機先篩好的候選（pokeapi.aiCandidates），AI 從裡面挑。
 * 回傳 [{ dexNo, name, en, reason }]，還沒對照到圖鑑索引（由 pokeapi.resolvePicks 做）。
 */
export async function aiSearch(query, candidates = []) {
  const key = env('OPENAI_API_KEY');
  if (!key) throw new HttpError(503, '尚未設定 OPENAI_API_KEY，無法交給 AI 判斷');
  const q = String(query || '').trim();
  if (!q) return [];

  const cacheKey = q.toLowerCase();
  const hit = aiCache.get(cacheKey);
  if (hit && Date.now() - hit.at < AI_CACHE_TTL) return hit.picks;

  const base = env('OPENAI_BASE_URL', 'https://api.openai.com/v1').replace(/\/+$/, '');
  const model = env('OPENAI_MODEL', 'gpt-4o-mini');
  const effort = env('OPENAI_REASONING_EFFORT'); // gpt-oss／o 系列推理模型才填（low 最快）
  const res = await fetch(`${base}/chat/completions`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${key}` },
    body: JSON.stringify({
      model,
      ...(effort ? { reasoning_effort: effort } : {}),
      messages: [
        { role: 'system', content: searchPrompt(candidates) },
        { role: 'user', content: q },
      ],
    }),
    signal: AbortSignal.timeout(20000), // 超過就改用本機候選前幾名，不讓人等太久
  }).catch((err) => {
    throw new HttpError(502, `連不到 AI：${err.message}`);
  });

  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new HttpError(502, `AI 回應 ${res.status}：${body?.error?.message || '未知錯誤'}`);
  const picks = parseAiPicks(body?.choices?.[0]?.message?.content);

  // 空的不記：多半是模型輸出亂碼解析不到，下次再問一次可能就好了
  if (picks.length) {
    if (aiCache.size >= AI_CACHE_MAX) aiCache.delete(aiCache.keys().next().value);
    aiCache.set(cacheKey, { at: Date.now(), picks });
  }
  return picks;
}

/* ---------- n8n ---------- */
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
