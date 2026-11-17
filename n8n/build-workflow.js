// 產生 n8n 匯入檔 pokedex-chat.json（AI 建議討論）：node n8n/build-workflow.js
// Code 節點的程式寫成真的 JS 函式（下面 chatPrepareCode 等），比在 JSON 裡跳脫字串好改，也能直接測。
//
// 流程：Webhook(POST /pokedex-chat) → 整理對話 → AI Agent → 取出回答 → 回傳回答
//                                                 │  └(錯誤)→ AI 失敗 → 回傳 502
//                                                 ├─ OpenAI Chat Model（接你的模型）
//                                                 └─ Simple Memory（Session Key＝網站給的 sessionId：每個瀏覽器每天一段）
import { writeFileSync, existsSync, unlinkSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

/* eslint-disable no-undef -- $input 是 n8n Code 節點提供的 */
// 網站送來 { sessionId, chatInput, system, messages }：
//  - 有 sessionId：前面的對話交給 Memory 節點記，這裡只給這次的問題
//  - 沒有（舊版網站或自己用 curl 測）：前面的對話接在系統提示後面，給一個只用一次的 session
export function chatPrepareCode() {
  const body = $input.first().json.body || {};
  const messages = (Array.isArray(body.messages) ? body.messages : [])
    .filter((m) => m && (m.role === 'user' || m.role === 'assistant') && m.content)
    .slice(-12);
  const last = messages[messages.length - 1];
  const prompt = String(body.chatInput || (last && last.role === 'user' ? last.content : '') || '請給這隻寶可夢的對戰建議');
  // body.system 是網站組好的系統提示（角色、規則、目前這隻的 PokeAPI 資料）；想自己寫就改這裡
  let system = body.system || `你是寶可夢對戰與培育的顧問。圖鑑資料：${JSON.stringify(body.pokemon || {})}`;
  let sessionId = String(body.sessionId || '').trim();
  if (!sessionId) {
    const earlier = messages.slice(0, -1);
    if (earlier.length) {
      system += '\n\n先前的對話（接著這段回答）：\n' +
        earlier.map((m) => `${m.role === 'user' ? '訓練家' : '顧問'}：${m.content}`).join('\n');
    }
    sessionId = `once-${Date.now()}-${Math.random().toString(36).slice(2)}`;
  }
  return [{ json: { sessionId, system, prompt } }];
}

export function chatReplyCode() {
  const r = $input.first().json;
  const text = String(r.output || r.text || '').trim(); // AI Agent 的回答在 output
  if (!text) return [{ json: { ok: false, source: 'n8n', text: 'AI 沒有回答（可能想太久被截斷），再問一次試試' } }];
  return [{ json: { ok: true, source: 'n8n', text } }];
}

export function chatErrorCode() {
  const e = $input.first().json;
  const msg = (e.error && (e.error.message || e.error.description)) || e.message || JSON.stringify(e).slice(0, 200);
  return [{ json: { ok: false, source: 'n8n', text: `n8n 呼叫 AI 失敗：${msg}` } }];
}
/* eslint-enable no-undef */

/** 取出函式本體當 Code 節點的 jsCode（去掉外層 function 與縮排） */
export function fnBody(fn) {
  const src = fn.toString().replace(/\r\n/g, '\n'); // Windows 簽出是 CRLF，產出統一用 LF
  const inner = src.slice(src.indexOf('{') + 1, src.lastIndexOf('}'));
  return inner.replace(/^\n/, '').replace(/^ {2}/gm, '').trimEnd() + '\n';
}

export const MEMORY_TURNS = 12; // Memory 記最近 12 來回（今天可能聊好幾隻；太多會撐爆模型的 context）

const CHAT_NOTE = `## PIXEL DEX × n8n：AI 建議討論（含記憶）
網站 .env 設 \`AI_PROVIDER=n8n\` 時，圖鑑頁的「AI 建議討論」會 POST：
\`{ "sessionId": "瀏覽器每天一個", "chatInput": "（在看 皮卡丘）對戰建議…", "system": "系統提示（含目前這隻的 PokeAPI 資料）" }\`

1. 「OpenAI Chat Model」：Credential 選 **OpenAI**（API Key；自架／相容服務把 Base URL 填 \`…/v1\`），Model 用 By ID 打名字
2. 「Simple Memory」：Session Key＝sessionId，同一個瀏覽器同一天＝同一段記憶（換寶可夢也接得上）
   ⚠ Simple Memory 存在 n8n 記憶體，n8n 重開就清空；要長久保存換成 **Postgres Chat Memory**（Session Key 一樣填 \`{{ $json.sessionId }}\`）
3. 右上 **Active** 打開，Production URL 填到網站 \`.env\`：\`N8N_CHAT_WEBHOOK_URL=\`

AI Agent 可以再接 Tool 節點（查資料、算傷害…），最後回傳 \`{ "text": "回答" }\` 就好。`;

export function buildChatWorkflow() {
  const code = (id, name, fn, position) => ({
    parameters: { jsCode: fnBody(fn) },
    id,
    name,
    type: 'n8n-nodes-base.code',
    typeVersion: 2,
    position,
  });
  const respond = (id, name, position, options = {}) => ({
    parameters: { respondWith: 'firstIncomingItem', options },
    id,
    name,
    type: 'n8n-nodes-base.respondToWebhook',
    typeVersion: 1.1,
    position,
  });
  const link = (node) => [{ node, type: 'main', index: 0 }];

  return {
    name: 'PIXEL DEX AI 建議討論（Webhook → AI Agent＋Memory）',
    nodes: [
      {
        parameters: { content: CHAT_NOTE, height: 400, width: 520 },
        id: '6a1e3c5b-7d9f-4b2a-8c4e-0f6b8d2a4c21',
        name: '說明',
        type: 'n8n-nodes-base.stickyNote',
        typeVersion: 1,
        position: [-80, -460],
      },
      {
        parameters: { httpMethod: 'POST', path: 'pokedex-chat', responseMode: 'responseNode', options: {} },
        id: '1c3e5a7b-9d2f-4e6a-b8c1-3d5f7a9b1c22',
        name: 'Webhook',
        type: 'n8n-nodes-base.webhook',
        typeVersion: 2,
        position: [0, 0],
        webhookId: '4e6a8c0b-2d4f-4a6c-9e1b-5f7d9b1d3e23',
      },
      code('8b0d2f4a-6c8e-4a1c-b3d5-7f9b1d3f5a24', '整理對話', chatPrepareCode, [240, 0]),
      {
        parameters: {
          promptType: 'define',
          text: '={{ $json.prompt }}',
          options: { systemMessage: '={{ $json.system }}' },
        },
        id: '3f5b7d9a-1c3e-4b5d-8f7a-9c1e3a5c7e25',
        name: 'AI Agent',
        type: '@n8n/n8n-nodes-langchain.agent',
        typeVersion: 1.7,
        position: [480, 0],
        onError: 'continueErrorOutput',
      },
      {
        parameters: {
          model: { __rl: true, mode: 'id', value: 'gpt-4o-mini' }, // By ID：自架模型直接打名字（例如 gpt-oss-20B）
          options: { timeout: 45000, maxRetries: 0 },
        },
        id: '0e2a4c6e-8b0d-4f2a-9c4e-6b8d0f2a4c30',
        name: 'OpenAI Chat Model',
        type: '@n8n/n8n-nodes-langchain.lmChatOpenAi',
        typeVersion: 1.2,
        position: [400, 240],
      },
      {
        parameters: {
          sessionIdType: 'customKey',
          sessionKey: '={{ $json.sessionId }}', // 網站給的：每個瀏覽器每天一個
          contextWindowLength: MEMORY_TURNS,
        },
        id: 'c4e6a8c0-2d4f-4b6a-8e0c-2a4c6e8a0c31',
        name: 'Simple Memory',
        type: '@n8n/n8n-nodes-langchain.memoryBufferWindow',
        typeVersion: 1.3,
        position: [580, 240],
      },
      code('5d7f9b1c-3e5a-4c7e-a9b2-1d3f5b7d9f26', '取出回答', chatReplyCode, [860, -100]),
      respond('7f9b1d3e-5a7c-4e9a-b1c3-3f5d7f9b1a27', '回傳回答', [1100, -100]),
      code('9b1d3f5a-7c9e-4a1b-83d5-5a7c9e1b3d28', 'AI 失敗', chatErrorCode, [860, 120]),
      respond('2a4c6e8b-0d2f-4c4e-a6b8-7c9e1a3c5e29', '回傳 502', [1100, 120], { responseCode: 502 }),
    ],
    connections: {
      Webhook: { main: [link('整理對話')] },
      整理對話: { main: [link('AI Agent')] },
      'AI Agent': { main: [link('取出回答'), link('AI 失敗')] },
      'OpenAI Chat Model': { ai_languageModel: [[{ node: 'AI Agent', type: 'ai_languageModel', index: 0 }]] },
      'Simple Memory': { ai_memory: [[{ node: 'AI Agent', type: 'ai_memory', index: 0 }]] },
      取出回答: { main: [link('回傳回答')] },
      'AI 失敗': { main: [link('回傳 502')] },
    },
    active: false,
    settings: { executionOrder: 'v1' },
    pinData: {},
    tags: [],
  };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const dir = path.dirname(fileURLToPath(import.meta.url));
  const out = path.join(dir, 'pokedex-chat.json');
  writeFileSync(out, JSON.stringify(buildChatWorkflow(), null, 2) + '\n');
  console.log('已輸出', out);
  const old = path.join(dir, 'pokedex-webhook.json'); // 舊的 n8n 圖鑑卡，已經拿掉
  if (existsSync(old)) {
    unlinkSync(old);
    console.log('已刪除舊的', old);
  }
}
