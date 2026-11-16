// 產生 n8n 匯入檔 pokedex-webhook.json：node n8n/build-workflow.js
// Code 節點的程式寫成真的 JS 函式（下面 cardCode / notFoundCode），比在 JSON 裡跳脫字串好改，也能直接測。
//
// 流程：Webhook(POST /pokedex) → PokeAPI 寶可夢 → PokeAPI 物種 → 組合圖鑑卡 → 回傳圖鑑卡
//                                   └(錯誤)────────┴(錯誤)→ 查無資料 → 回傳 404
import { writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

/* eslint-disable no-undef -- $ 與 $input 是 n8n Code 節點提供的 */
export function cardCode() {
  const req = $('Webhook').first().json;
  const body = req.body || {};
  const p = $('PokeAPI 寶可夢').first().json;
  const s = $input.first().json;

  const TYPE_ZH = {
    normal: '一般', fire: '火', water: '水', electric: '電', grass: '草', ice: '冰', fighting: '格鬥', poison: '毒',
    ground: '地面', flying: '飛行', psychic: '超能力', bug: '蟲', rock: '岩石', ghost: '幽靈', dragon: '龍', dark: '惡',
    steel: '鋼', fairy: '妖精',
  };
  const STAT_ZH = { hp: 'HP', attack: '攻擊', defense: '防禦', 'special-attack': '特攻', 'special-defense': '特防', speed: '速度' };
  const byLang = (arr, lang) => (arr || []).filter((x) => x.language.name === lang);

  const zh = (byLang(s.names, 'zh-hant')[0] || byLang(s.names, 'en')[0] || { name: p.name }).name;
  const genus = (byLang(s.genera, 'zh-hant')[0] || byLang(s.genera, 'en')[0] || { genus: '' }).genus;
  const types = [...p.types].sort((a, b) => a.slot - b.slot).map((t) => TYPE_ZH[t.type.name] || t.type.name);
  const stats = p.stats.map((st) => ({ label: STAT_ZH[st.stat.name] || st.stat.name, value: st.base_stat }));
  const total = stats.reduce((n, st) => n + st.value, 0);
  const best = stats.reduce((a, b) => (b.value > a.value ? b : a));
  const role = best.label === '速度' ? '速攻型' : ['攻擊', '特攻'].includes(best.label) ? '輸出型' : best.label === 'HP' ? '耐久型' : '防守型';

  const entry = byLang(s.flavor_text_entries, 'zh-hant').at(-1) || byLang(s.flavor_text_entries, 'en').at(-1);
  const flavor = entry
    ? entry.flavor_text.replace(/[\n\f­]+/g, entry.language.name === 'en' ? ' ' : '').trim()
    : '';
  const no = String(s.id).padStart(3, '0');

  const lines = [
    `【No.${no} ${zh}】${genus}`,
    `屬性：${types.join('／')}`,
    `種族值：${stats.map((st) => `${st.label} ${st.value}`).join('／')}（總和 ${total}）`,
    `最突出：${best.label} ${best.value}，偏${role}`,
    flavor ? `圖鑑：${flavor}` : '',
    body.message ? `你說：「${body.message}」——收到！（可以在這裡接 OpenAI、LINE、Google Sheets 節點）` : '',
    '—— 這段由 n8n 工作流產生',
  ].filter(Boolean);

  return [{
    json: {
      ok: true,
      source: 'n8n',
      text: lines.join('\n'),
      card: { id: p.id, no, name: zh, slug: p.name, genus, types, stats, total, sprite: p.sprites.front_default },
    },
  }];
}

export function notFoundCode() {
  const req = $('Webhook').first().json;
  const body = req.body || {};
  const name = body.name || body.id || (req.query && req.query.name) || '';
  return [{ json: { ok: false, source: 'n8n', text: `n8n 在 PokeAPI 找不到「${name}」` } }];
}
/* eslint-enable no-undef */

/** 取出函式本體當 Code 節點的 jsCode（去掉外層 function 與縮排） */
export function fnBody(fn) {
  const src = fn.toString();
  const inner = src.slice(src.indexOf('{') + 1, src.lastIndexOf('}'));
  return inner.replace(/^\n/, '').replace(/^ {2}/gm, '').trimEnd() + '\n';
}

const NOTE = `## PIXEL DEX × n8n
網頁按「送到 n8n」會 POST：
\`{ "id": 25, "name": "pikachu", "message": "…", "pokemon": {摘要} }\`

1. 右上 **Active** 打開 → 用 Production URL（/webhook/pokedex）
2. 或按 Webhook 的 **Listen for test event** → 用 Test URL（/webhook-test/pokedex，一次有效）
3. 網址填到網頁專案的 \`.env\`：\`N8N_WEBHOOK_URL=\`

想加 AI：在「組合圖鑑卡」後面接 OpenAI 節點，再把結果放進回傳的 \`text\`。`;

export function buildWorkflow() {
  const http = (id, name, url, position) => ({
    parameters: { url, options: {} },
    id,
    name,
    type: 'n8n-nodes-base.httpRequest',
    typeVersion: 4.2,
    position,
    onError: 'continueErrorOutput',
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
    name: 'PIXEL DEX 圖鑑卡（Webhook → PokeAPI）',
    nodes: [
      {
        parameters: { content: NOTE, height: 300, width: 420 },
        id: 'b3a4f0e2-4c1d-4b8e-9a51-0c7d2f6e8a01',
        name: '說明',
        type: 'n8n-nodes-base.stickyNote',
        typeVersion: 1,
        position: [-80, -360],
      },
      {
        parameters: { httpMethod: 'POST', path: 'pokedex', responseMode: 'responseNode', options: {} },
        id: '5f0d6c55-7a3e-4f0b-8f43-2b9e1c7d3a10',
        name: 'Webhook',
        type: 'n8n-nodes-base.webhook',
        typeVersion: 2,
        position: [0, 0],
        webhookId: '9d2c4b7e-1f6a-4e3d-b8c5-7a0e2f1d6c39',
      },
      http(
        'c1e7a9d2-3b4f-4a6e-8d1c-5f2b7e9a0c11',
        'PokeAPI 寶可夢',
        "=https://pokeapi.co/api/v2/pokemon/{{ encodeURIComponent(String($json.body.name || $json.body.id || $json.query.name || 'missing').trim().toLowerCase()) }}",
        [240, 0],
      ),
      http('e8b2c4f6-9a1d-4e7b-a3c5-1d6f8b0e2a12', 'PokeAPI 物種', '={{ $json.species.url }}', [480, -80]),
      {
        parameters: { jsCode: fnBody(cardCode) },
        id: 'a7d9e1b3-5c2f-4d8a-9e6b-3f1c7a5d0b13',
        name: '組合圖鑑卡',
        type: 'n8n-nodes-base.code',
        typeVersion: 2,
        position: [720, -160],
      },
      respond('f2c6a8e0-1b3d-4f5a-8c7e-9d0b2a4c6e14', '回傳圖鑑卡', [960, -160]),
      {
        parameters: { jsCode: fnBody(notFoundCode) },
        id: 'd4f6b8a0-2c5e-4a7d-b9f1-6e3a8c0d2f15',
        name: '查無資料',
        type: 'n8n-nodes-base.code',
        typeVersion: 2,
        position: [720, 160],
      },
      respond('0b2d4f6a-8c1e-4b3d-a5f7-c9e1b3d5f716', '回傳 404', [960, 160], { responseCode: 404 }),
    ],
    connections: {
      Webhook: { main: [link('PokeAPI 寶可夢')] },
      'PokeAPI 寶可夢': { main: [link('PokeAPI 物種'), link('查無資料')] },
      'PokeAPI 物種': { main: [link('組合圖鑑卡'), link('查無資料')] },
      組合圖鑑卡: { main: [link('回傳圖鑑卡')] },
      查無資料: { main: [link('回傳 404')] },
    },
    active: false,
    settings: { executionOrder: 'v1' },
    pinData: {},
    tags: [],
  };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const out = path.join(path.dirname(fileURLToPath(import.meta.url)), 'pokedex-webhook.json');
  writeFileSync(out, JSON.stringify(buildWorkflow(), null, 2) + '\n');
  console.log('已輸出', out);
}
