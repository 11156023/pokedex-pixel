// AI 建議討論：圖鑑頁下方的對話區（OpenAI 或 n8n，由 .env 的 AI_PROVIDER 決定）。
// 一天一段對話：換寶可夢不清掉，每則問題標上當時在看哪一隻，AI 會參考今天聊過的其他寶可夢。
//  - openai：網站每次帶今天最近的對話給模型（記憶在瀏覽器）
//  - n8n   ：帶 sessionId（每個瀏覽器、每一天一個），由 n8n AI Agent 的 Memory 節點記住對話
import { HttpError } from './pokeapi.js';

const env = (k, d = '') => (process.env[k] ?? d).trim();

/** AI_PROVIDER=openai | n8n | off；留空＝自動（有 OpenAI 金鑰用 OpenAI，否則有 n8n 討論網址用 n8n） */
export function chatProvider() {
  const want = env('AI_PROVIDER').toLowerCase();
  const hasOpenai = Boolean(env('OPENAI_API_KEY'));
  const hasN8n = Boolean(env('N8N_CHAT_WEBHOOK_URL'));
  if (want === 'off') return null;
  if (want === 'openai') return hasOpenai ? 'openai' : null;
  if (want === 'n8n') return hasN8n ? 'n8n' : null;
  return hasOpenai ? 'openai' : hasN8n ? 'n8n' : null;
}

export function integrationStatus() {
  const provider = chatProvider();
  return {
    chat: provider,
    model: provider === 'openai' ? env('OPENAI_MODEL', 'gpt-4o-mini') : null,
  };
}

/* ---------- 對話整理 ---------- */
export const CHAT_MAX_MESSAGES = 20; // openai 模式帶最近 20 則（今天可能聊好幾隻），太舊的丟掉
const USER_MAX = 300;
const ASSISTANT_MAX = 2000;
const NAME_MAX = 20;

/** 系統提示：角色、規則、目前這隻寶可夢的 PokeAPI 資料（屬性／種族值／特性／弱點以資料為準） */
export function chatSystemPrompt(summary) {
  return [
    `你是寶可夢對戰與培育的顧問。訓練家現在正在看「${summary.name}」（No.${String(summary.dexNo).padStart(3, '0')}）。`,
    '一律用繁體中文（台灣用語），寶可夢、招式、特性、道具用台灣官方譯名。',
    '屬性、種族值、特性、弱點以下面的 PokeAPI 圖鑑資料為準，不要自己編數字；資料沒有的（招式、道具、性格）可以用一般寶可夢知識建議，不確定就說不確定。',
    '回答精簡，全部 250 字以內，用 Markdown 排版：第一句講結論（重點用 **粗體**），再用「- 」條列 2～4 點；需要分段可以用 ### 小標，比較數值可以用表格。',
    '這是訓練家今天的整段討論：每個問題開頭的「（在看 某某）」是他問的時候正在看哪一隻。',
    '今天前面聊過的寶可夢要記得：相關時一起考慮（例如配隊時看前面討論過的隊員能不能互補、弱點有沒有重疊），也可以主動提到。',
    '話題離寶可夢太遠就簡短帶回來。',
    '',
    `目前這隻的圖鑑資料（JSON）：${JSON.stringify(summary)}`,
  ].join('\n');
}

const cleanName = (p) => String(p?.name ?? '').replace(/[\r\n（）()]/g, '').trim().slice(0, NAME_MAX);

/** 使用者的話前面標上當時在看哪一隻：「（在看 皮卡丘）對戰建議」 */
export const tagged = (m) => (m.role === 'user' && m.pokemon ? `（在看 ${m.pokemon}）${m.content}` : m.content);

/**
 * 整理瀏覽器送來的對話：只留 user／assistant、去掉空的、限制長度與則數，最後一則一定要是 user。
 * 回傳 [{ role, content, pokemon }]（pokemon 是名字，可能是空字串）；格式不對丟 400。
 */
export function cleanHistory(messages) {
  if (!Array.isArray(messages)) throw new HttpError(400, 'messages 要是陣列');
  const list = messages
    .filter((m) => m && (m.role === 'user' || m.role === 'assistant'))
    .map((m) => ({
      role: m.role,
      content: String(m.content ?? '').trim().slice(0, m.role === 'user' ? USER_MAX : ASSISTANT_MAX),
      pokemon: cleanName(m.pokemon),
    }))
    .filter((m) => m.content)
    .slice(-CHAT_MAX_MESSAGES);
  while (list.length && list[0].role !== 'user') list.shift(); // 被截掉一半時，從使用者的話開始
  if (!list.length || list.at(-1).role !== 'user') throw new HttpError(400, '最後一則要是使用者的問題');
  return list;
}

/** 瀏覽器產生的對話 ID（UUID 或 hex）；n8n Memory 用它分開每個瀏覽器、每一天 */
export function cleanSession(id) {
  const s = String(id ?? '').trim();
  return /^[A-Za-z0-9-]{8,64}$/.test(s) ? s : null;
}

/** 依 AI_PROVIDER 轉給 OpenAI 或 n8n，回傳 { text, provider } */
export async function chat(summary, messages, sessionId) {
  const provider = chatProvider();
  if (!provider) throw new HttpError(503, '沒有啟用 AI 建議討論（.env 的 AI_PROVIDER／OPENAI_API_KEY／N8N_CHAT_WEBHOOK_URL）');
  const history = cleanHistory(messages);
  const system = chatSystemPrompt(summary);
  let text;
  if (provider === 'openai') {
    text = await chatOpenAI(system, history);
  } else {
    const session = cleanSession(sessionId);
    if (!session) throw new HttpError(400, 'sessionId 格式不對（重新整理頁面再試）');
    text = await chatN8n(summary, system, history, session);
  }
  return { text, provider }; // Markdown 原樣回傳，瀏覽器的 md.js 負責排版（不用 innerHTML）
}

async function chatOpenAI(system, history) {
  const key = env('OPENAI_API_KEY');
  const base = env('OPENAI_BASE_URL', 'https://api.openai.com/v1').replace(/\/+$/, '');
  const model = env('OPENAI_MODEL', 'gpt-4o-mini');
  const effort = env('OPENAI_REASONING_EFFORT'); // gpt-oss／o 系列推理模型才填（low 最快）
  const res = await fetch(`${base}/chat/completions`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${key}` },
    body: JSON.stringify({
      model,
      ...(effort ? { reasoning_effort: effort } : {}),
      messages: [{ role: 'system', content: system }, ...history.map((m) => ({ role: m.role, content: tagged(m) }))],
    }),
    signal: AbortSignal.timeout(45000),
  }).catch((err) => {
    throw new HttpError(502, `連不到 AI：${err.message}`);
  });

  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new HttpError(502, `AI 回應 ${res.status}：${body?.error?.message || '未知錯誤'}`);
  const text = String(body?.choices?.[0]?.message?.content ?? '').trim();
  if (!text) throw new HttpError(502, 'AI 沒有回答（可能想太久被截斷），再問一次試試');
  return text;
}

async function chatN8n(summary, system, history, sessionId) {
  const payload = {
    event: 'pokedex.chat',
    sessionId, // n8n Memory 節點的 Session Key：同一個瀏覽器同一天＝同一段記憶
    chatInput: tagged(history.at(-1)), // 這次的問題（標好在看哪一隻）；前面的對話由 n8n Memory 記
    system, // 網站組好的系統提示（含目前這隻的 PokeAPI 資料）；n8n flow 可以直接用，也可以自己改
    messages: history.map((m) => ({ role: m.role, content: tagged(m) })), // 參考用：flow 沒接 Memory 時可以拿這個
    id: summary.id,
    name: summary.slug,
    pokemon: summary,
    sentAt: new Date().toISOString(),
  };
  const data = await postN8n(env('N8N_CHAT_WEBHOOK_URL'), payload, 50000);
  const text = String(data?.text ?? '').trim();
  if (!text) throw new HttpError(502, 'n8n 沒有回傳 text（檢查 flow 的「取出回答」節點）');
  return text;
}

/** POST 到 n8n Webhook，回傳第一個 item（物件；純文字包成 { text }）。flow 自己回 ok:false 時丟出它的 text。 */
async function postN8n(url, payload, timeoutMs) {
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(payload),
    signal: AbortSignal.timeout(timeoutMs),
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
  const first = Array.isArray(data) ? data[0] : data;
  if (first?.ok === false && first.text) throw new HttpError(res.status === 404 ? 404 : 502, first.text); // flow 自己回的錯誤
  if (!res.ok) {
    const hint =
      res.status === 404
        ? '（測試網址要先在 n8n 按「Listen for test event」，正式網址要先把 workflow 設成 Active）'
        : '';
    throw new HttpError(502, `n8n 回應 ${res.status}${hint}：${data?.message || raw.slice(0, 200)}`);
  }
  if (first && typeof first === 'object') return first;
  return { text: typeof first === 'string' ? first : raw };
}
