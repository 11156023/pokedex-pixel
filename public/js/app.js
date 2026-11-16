import { h, api, toast, loadingState, emptyState, errorState, cell, sectionTitle, segmented, typewriter, typeChip, pad3 } from './ui.js';

const $ = (s) => document.querySelector(s);
const view = $('#view');
const input = $('#q');
const list = $('#results');
const form = $('#search-form');

const state = {
  status: null,
  current: null,
  spriteMode: 'front',
  loadSeq: 0,
  loading: false,
  results: [],
  active: -1,
  searchSeq: 0,
  searchCtl: null,
  stopType: null,
  ask: { busy: false, out: null },
};

const EGG_ZH = {
  monster: '怪獸', water1: '水中1', water2: '水中2', water3: '水中3', bug: '蟲', flying: '飛行', ground: '陸上',
  fairy: '妖精', plant: '植物', humanshape: '人型', mineral: '礦物', indeterminate: '不定形', ditto: '百變怪',
  dragon: '龍', 'no-eggs': '未發現',
};

/* =========================================================
   連線狀態燈（PokeAPI＋.env 啟用的那個串接）
   ========================================================= */
function setLed(name, ledState, title, label) {
  const el = document.querySelector(`[data-led="${name}"]`);
  el.dataset.state = ledState;
  el.title = title;
  if (label != null) el.querySelector('span').textContent = label;
}

async function loadStatus() {
  try {
    const st = await api('/api/status');
    state.status = st;
    const p = st.pokeapi;
    setLed('pokeapi', p.ready ? 'on' : p.error ? 'error' : 'wait',
      p.ready ? `名稱索引 ${p.count} 筆` : p.error || '名稱索引載入中');
    const askLed = document.querySelector('[data-led="ask"]');
    askLed.hidden = !st.ask;
    if (st.ask) setLed('ask', 'on', st.ask === 'openai' ? `模型 ${st.model}` : 'n8n Webhook', st.ask === 'openai' ? 'OpenAI' : 'n8n');
    if (!p.ready) setTimeout(loadStatus, 3000);
    if (state.current) renderAsk();
  } catch {
    setLed('pokeapi', 'error', '連不到本機伺服器');
    setTimeout(loadStatus, 5000);
  }
}

/* =========================================================
   搜尋（combobox；下拉 portal 在 body，fixed 錨定在搜尋列下方）
   ========================================================= */
let debounce = null;

input.addEventListener('input', () => {
  clearTimeout(debounce);
  if (!input.value.trim()) {
    state.searchCtl?.abort();
    closeList();
    return;
  }
  debounce = setTimeout(runSearch, 120);
});

input.addEventListener('focus', () => {
  if (state.results.length && input.value.trim()) openList();
});

async function runSearch() {
  const q = input.value.trim();
  if (!q) return closeList();
  const seq = ++state.searchSeq;
  state.searchCtl?.abort();
  state.searchCtl = new AbortController();
  try {
    const { results } = await api(`/api/search?q=${encodeURIComponent(q)}&limit=12`, { signal: state.searchCtl.signal });
    if (seq !== state.searchSeq) return;
    state.results = results;
    state.active = results.length ? 0 : -1;
    renderList(q);
  } catch (err) {
    if (err.name === 'AbortError') return;
    toast(err.message, { type: 'error', id: 'search' });
  }
}

/** 查詢字依序出現就標亮（打錯字時不標，免得亂亮） */
function highlight(text, q) {
  const needle = Array.from(q.toLowerCase().replace(/\s+/g, ''));
  const chars = Array.from(text);
  const marks = new Set();
  let qi = 0;
  chars.forEach((c, i) => {
    if (qi < needle.length && c.toLowerCase() === needle[qi]) {
      marks.add(i);
      qi += 1;
    }
  });
  if (qi < needle.length) return [text];
  const out = [];
  let buf = '';
  let inMark = false;
  const flush = () => {
    if (!buf) return;
    out.push(inMark ? h('mark', {}, buf) : buf);
    buf = '';
  };
  chars.forEach((c, i) => {
    const m = marks.has(i);
    if (m !== inMark) {
      flush();
      inMark = m;
    }
    buf += c;
  });
  flush();
  return out;
}

function renderList(q) {
  if (!state.results.length) {
    list.replaceChildren(h('li', { class: 'results-empty', role: 'presentation' }, `找不到和「${q}」相近的寶可夢`));
    openList();
    return;
  }
  list.replaceChildren(
    ...state.results.map((r, i) =>
      h('li', {
        class: 'result',
        id: `opt-${i}`,
        role: 'option',
        'aria-selected': String(i === state.active),
        onmousedown: (e) => e.preventDefault(), // 保留輸入框焦點
        onclick: () => choose(i),
        onmousemove: () => setActive(i, false),
      },
      h('img', { src: r.sprite, alt: '', width: 48, height: 48, loading: 'lazy', onerror: (e) => (e.target.style.visibility = 'hidden') }),
      h('span', { class: 'no' }, `No.${pad3(r.dexNo)}`),
      h('span', { class: 'nm' }, highlight(r.zh || r.en, q), r.zh ? h('small', {}, highlight(r.en, q)) : null),
      h('span', { class: 'chips' }, r.types.map((t) => typeChip(t, 'chip-sm'))),
      ),
    ),
  );
  openList();
}

/** 錨定在搜尋列正下方；搜尋列捲到頁首底下就收起來 */
function placeList() {
  const r = form.getBoundingClientRect();
  const headerBottom = document.querySelector('.top').getBoundingClientRect().bottom;
  if (r.bottom < Math.max(0, headerBottom) || r.top > window.innerHeight) {
    closeList();
    return;
  }
  list.style.left = `${r.left}px`;
  list.style.top = `${r.bottom + 4}px`;
  list.style.width = `${r.width}px`;
  list.style.maxHeight = `${Math.max(160, Math.min(520, window.innerHeight - r.bottom - 16))}px`;
}

function openList() {
  list.hidden = false;
  placeList();
  input.setAttribute('aria-expanded', 'true');
  input.setAttribute('aria-activedescendant', state.active >= 0 ? `opt-${state.active}` : '');
}

function closeList() {
  list.hidden = true;
  input.setAttribute('aria-expanded', 'false');
  input.removeAttribute('aria-activedescendant');
}

window.addEventListener('scroll', () => !list.hidden && placeList(), { passive: true, capture: true });
window.addEventListener('resize', () => !list.hidden && placeList());

function setActive(i, scroll = true) {
  if (i === state.active) return;
  state.active = i;
  list.querySelectorAll('.result').forEach((el, j) => el.setAttribute('aria-selected', String(j === i)));
  input.setAttribute('aria-activedescendant', `opt-${i}`);
  if (scroll) list.querySelector(`#opt-${i}`)?.scrollIntoView({ block: 'nearest' });
}

function choose(i) {
  const r = state.results[i];
  if (!r) return;
  closeList();
  input.value = r.zh || r.en;
  input.blur();
  loadPokemon(r.slug);
}

input.addEventListener('keydown', (e) => {
  const n = state.results.length;
  if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
    if (!n) return;
    e.preventDefault();
    if (list.hidden) return openList();
    const step = e.key === 'ArrowDown' ? 1 : -1;
    setActive((state.active + step + n) % n);
  } else if (e.key === 'Escape') {
    if (!list.hidden) {
      e.preventDefault();
      closeList();
    }
  }
});

form.addEventListener('submit', async (e) => {
  e.preventDefault();
  const q = input.value.trim();
  if (!q) return;
  clearTimeout(debounce);
  // 下拉有結果就選目前那筆；還沒回來就讓伺服器直接找最接近的
  if (!list.hidden && state.results.length && state.active >= 0) return choose(state.active);
  closeList();
  input.blur();
  loadPokemon(q);
});

document.addEventListener('mousedown', (e) => {
  if (!e.target.closest('#search-form, #results')) closeList();
});

$('#btn-random').addEventListener('click', randomPokemon);

async function randomPokemon() {
  try {
    const { id } = await api('/api/random');
    loadPokemon(String(id));
  } catch (err) {
    toast(err.message, { type: 'error', id: 'random' });
  }
}

/* =========================================================
   讀取單隻
   ========================================================= */
async function loadPokemon(key, { push = true } = {}) {
  const seq = ++state.loadSeq;
  state.loading = true;
  if (!state.current) view.replaceChildren(loadingState('讀取圖鑑資料'));
  else view.setAttribute('aria-busy', 'true');
  view.style.opacity = state.current ? '0.6' : '';

  try {
    const d = await api(`/api/pokemon/${encodeURIComponent(key)}`);
    if (seq !== state.loadSeq) return;
    const changed = state.current?.id !== d.id;
    state.current = d;
    if (changed) {
      state.spriteMode = d.sprites.front ? 'front' : 'art';
      state.ask.out = null;
    }
    renderDetail(d);
    if (d.resolvedFrom) toast(`「${d.resolvedFrom}」最接近的是 ${d.names.zh}`, { type: 'info', id: 'resolved' });
    const url = new URL(location.href);
    url.searchParams.set('p', d.slug);
    if (push && url.href !== location.href) history.pushState({ p: d.slug }, '', url);
    else history.replaceState({ p: d.slug }, '', url);
    document.title = `No.${pad3(d.dexNo)} ${d.names.zh} — PIXEL DEX`;
    const panel = document.querySelector('.panel');
    if (panel.getBoundingClientRect().top < 0) panel.scrollIntoView({ block: 'start' });
  } catch (err) {
    if (seq !== state.loadSeq) return;
    if (state.current) toast(err.message, { type: err.status === 404 ? 'warning' : 'error', id: 'load' });
    else view.replaceChildren(errorState(err.message, err.status === 404 ? null : () => loadPokemon(key, { push })));
  } finally {
    if (seq === state.loadSeq) {
      state.loading = false;
      view.removeAttribute('aria-busy');
      view.style.opacity = '';
    }
  }
}

window.addEventListener('popstate', () => {
  const p = new URL(location.href).searchParams.get('p');
  if (p) loadPokemon(p, { push: false });
  else {
    state.current = null;
    view.replaceChildren(emptyState());
    document.title = 'PIXEL DEX 像素圖鑑';
  }
});

/* =========================================================
   畫面：.dex 是兩欄格線（5：7），同一排左右格子等高，分隔線上下對齊
   ┌ 點陣圖   ┬ 名字／說明／基本資料／特性 ┐
   ├ 受到傷害 ┼ 種族值                    ┤
   ├ 進化＋形態（整排）                   ┤
   └ 串接（整排；.env 沒啟用就不出現）    ┘
   ========================================================= */
function renderDetail(d) {
  state.stopType?.();
  const flavorEl = h('p', { class: 'dialog-text', title: '點一下直接顯示全文' });
  const grid = h('div', { class: 'dex' },
    screenCell(d),
    infoCell(d, flavorEl),
    matchupCell(d),
    statsCell(d),
    evolutionCell(d),
    h('section', { class: 'cell c-full ask', id: 'ask-slot', hidden: true }),
  );
  view.replaceChildren(grid);
  renderAsk();
  state.stopType = typewriter(flavorEl, d.flavor?.text || '（這隻還沒有圖鑑說明）');
  // 種族值條：先 0 再長到目標寬度（setTimeout，背景分頁也會到位）
  setTimeout(() => {
    view.querySelectorAll('.stat .fill').forEach((el) => (el.style.width = el.dataset.w));
  }, 30);
}

const SPRITE_MODES = [
  { value: 'front', label: '一般', key: 'front' },
  { value: 'shiny', label: '色違', key: 'shiny' },
  { value: 'back', label: '背面', key: 'back' },
  { value: 'gen1', label: '初代', key: 'gen1', title: '紅／綠版的原始點陣圖（只有第 1 世代有）' },
  { value: 'art', label: '原畫', key: 'artwork' },
];

function stageContent(d) {
  const mode = SPRITE_MODES.find((m) => m.value === state.spriteMode) || SPRITE_MODES[0];
  const src = d.sprites[mode.key] || d.sprites.front || d.sprites.artwork;
  if (!src) return [h('span', { class: 'stage-none' }, 'NO IMAGE')];
  return [
    h('img', {
      src,
      alt: `${d.names.zh}（${mode.label}）`,
      class: mode.value === 'art' ? 'artwork' : 'sprite',
      onerror: (e) => e.target.replaceWith(h('span', { class: 'stage-none' }, 'NO IMAGE')),
    }),
  ];
}

function screenCell(d) {
  const stage = h('div', { class: 'stage' }, stageContent(d));
  const modes = segmented({
    label: '圖片樣式',
    cls: 'sprite-modes',
    value: state.spriteMode,
    options: SPRITE_MODES.map((m) => ({ ...m, disabled: !d.sprites[m.key] })),
    onChange: (v) => {
      state.spriteMode = v;
      stage.replaceChildren(...stageContent(d));
    },
  });
  const cry = d.cries.legacy || d.cries.latest;

  return h('section', { class: 'cell c-left screen', 'aria-label': '圖片' },
    stage,
    modes,
    h('div', { class: 'pad' },
      h('button', {
        class: 'btn', type: 'button', disabled: !d.nav.prev || null, title: '上一隻（←）',
        onclick: () => loadPokemon(String(d.nav.prev)),
      }, h('span', { class: 'px' }, '◀'), d.nav.prev ? pad3(d.nav.prev) : '---'),
      h('button', {
        class: 'btn btn-a', type: 'button', disabled: !cry || null, title: d.cries.legacy ? '經典版叫聲' : '叫聲',
        onclick: () => playCry(cry),
      }, h('span', { class: 'px' }, '♪'), '叫聲'),
      h('button', {
        class: 'btn', type: 'button', disabled: !d.nav.next || null, title: '下一隻（→）',
        onclick: () => loadPokemon(String(d.nav.next)),
      }, d.nav.next ? pad3(d.nav.next) : '---', h('span', { class: 'px' }, '▶')),
    ),
  );
}

let audio = null;
function playCry(src) {
  audio?.pause();
  audio = new Audio(src);
  audio.volume = 0.4;
  audio.play().catch(() => toast('這個瀏覽器無法播放 .ogg 叫聲', { type: 'warning', id: 'cry' }));
}

function infoCell(d, flavorEl) {
  const flags = [
    d.isLegendary && '傳說',
    d.isMythical && '幻之',
    d.isBaby && '幼年',
    !d.isDefault && '形態',
  ].filter(Boolean);

  const fact = (label, ...value) => h('div', {}, h('dt', {}, label), h('dd', {}, ...value));

  return h('section', { class: 'cell c-right info', 'aria-label': '基本資料' },
    h('header', { class: 'hero' },
      h('div', { class: 'hero-name' },
        h('p', { class: 'dex-no' }, `No.${pad3(d.dexNo)}`),
        h('h2', { class: 'name-zh' }, d.names.zh),
        h('p', { class: 'name-en' }, d.names.en),
      ),
      h('div', { class: 'tags' }, d.types.map((t) => typeChip(t, 'chip-lg')), flags.map((x) => h('span', { class: 'flag' }, x))),
    ),
    h('div', { class: 'dialog' }, flavorEl),
    h('dl', { class: 'facts' },
      fact('分類', d.genus || '—'),
      fact('身高', h('span', { class: 'px' }, d.height), ' m'),
      fact('體重', h('span', { class: 'px' }, d.weight), ' kg'),
      fact('性別', d.gender.split('　').map((g) => h('span', { class: 'keep' }, g))),
      fact('世代', '第 ', h('span', { class: 'px' }, d.generation), ' 世代'),
      fact('捕獲率', h('span', { class: 'px' }, d.captureRate), ' / 255'),
      fact('蛋群', d.eggGroups.map((g) => EGG_ZH[g] || g).join('、') || '—'),
      fact('招式', h('span', { class: 'px' }, d.movesCount), ' 招'),
    ),
    h('ul', { class: 'abilities', 'aria-label': '特性' },
      d.abilities.map((a) =>
        h('li', {},
          h('div', { class: 'ab-name' },
            h('b', {}, a.zh),
            a.hidden ? h('span', { class: 'hidden-tag' }, '隱藏特性') : null,
          ),
          a.desc ? h('p', {}, a.desc) : null,
        ),
      ),
    ),
  );
}

function statColor(v) {
  if (v < 50) return '#F83800';
  if (v < 70) return '#FCA044';
  if (v < 90) return '#F8B800';
  if (v < 110) return '#B8F818';
  if (v < 130) return '#58D854';
  return '#3CBCFC';
}

function statsCell(d) {
  const stars = d.total >= 600 ? 5 : d.total >= 500 ? 4 : d.total >= 400 ? 3 : d.total >= 300 ? 2 : 1;
  return cell({ cls: 'c-right', title: '種族值' },
    h('dl', { class: 'stats' },
      d.stats.map((s) =>
        h('div', { class: 'stat' },
          h('dt', {}, s.label),
          h('dd', { class: 'val' }, s.value),
          h('dd', { class: 'meter', role: 'meter', 'aria-valuemin': 0, 'aria-valuemax': 255, 'aria-valuenow': s.value, 'aria-label': s.label },
            h('span', { class: 'fill', style: { '--bar': statColor(s.value) }, dataset: { w: `${Math.min(100, (s.value / 200) * 100)}%` } }),
          ),
        ),
      ),
      h('div', { class: 'stat stat-total' },
        h('dt', {}, '總和'),
        h('dd', { class: 'val' }, d.total),
        h('dd', { class: 'stars', title: '依總和分級：300／400／500／600' }, '★'.repeat(stars) + '☆'.repeat(5 - stars)),
      ),
    ),
  );
}

function matchupCell(d) {
  const rows = [['x4', '×4'], ['x2', '×2'], ['x05', '×½'], ['x025', '×¼'], ['x0', '×0']].filter(([k]) => d.matchups[k].length);
  return cell({ cls: 'c-left', title: '受到傷害' },
    h('div', { class: 'matchups' },
      rows.map(([k, mul]) =>
        h('div', { class: 'mu-row' },
          h('div', { class: `mul mul-${k}` }, mul),
          h('div', { class: 'chips' }, d.matchups[k].map((t) => typeChip(t))),
        ),
      ),
    ),
  );
}

function evolutionCell(d) {
  const stages = d.evolution || [];
  let evo;
  if (stages.length <= 1) {
    evo = h('p', { class: 'muted-line' }, '不會進化');
  } else {
    evo = h('div', { class: 'evo' });
    stages.forEach((stage, i) => {
      if (i > 0) evo.append(h('span', { class: 'evo-arrow', 'aria-hidden': 'true' }, '▶'));
      evo.append(
        h('div', { class: `evo-stage ${stage.length > 3 ? 'many' : ''}`.trim() },
          stage.map((n) =>
            h('button', {
              class: 'evo-node',
              type: 'button',
              'aria-current': n.id === d.dexNo ? 'true' : null,
              onclick: () => n.id !== d.id && loadPokemon(String(n.id)),
            },
            h('img', { src: n.sprite, alt: '', width: 64, height: 64, loading: 'lazy' }),
            h('span', {}, h('span', { class: 'nm' }, n.zh), n.cond ? h('span', { class: 'cond' }, n.cond) : null),
            ),
          ),
        ),
      );
    });
  }

  const forms = d.varieties.length > 1
    ? h('div', { class: 'forms' },
        d.varieties.map((v) =>
          h('button', {
            class: 'btn', type: 'button', 'aria-pressed': String(v.id === d.id),
            onclick: () => v.id !== d.id && loadPokemon(String(v.id)),
          }, v.zh),
        ),
      )
    : null;

  return cell({ cls: 'c-full', title: forms ? '進化與形態' : '進化' }, evo, forms);
}

/* =========================================================
   串接格：用 OpenAI 還是 n8n 由 .env 決定（/api/status 的 ask），沒啟用就隱藏
   ========================================================= */
const ASK_COPY = {
  openai: { title: 'AI 解說', placeholder: '想問什麼？留空就介紹這隻', button: '問 AI' },
  n8n: { title: 'n8n', placeholder: '要附帶的訊息（可留空）', button: '送出' },
};

function renderAsk() {
  const slot = document.getElementById('ask-slot');
  const d = state.current;
  const provider = state.status?.ask;
  if (!slot || !d) return;
  slot.hidden = !provider;
  if (!provider) return slot.replaceChildren();

  const copy = ASK_COPY[provider];
  const field = h('input', {
    type: 'text', maxlength: 300, placeholder: copy.placeholder, 'aria-label': copy.placeholder,
    onkeydown: (e) => e.key === 'Enter' && !e.isComposing && send(),
  });
  const btn = h('button', { class: 'btn btn-a', type: 'button', disabled: state.ask.busy || null, onclick: send },
    state.ask.busy ? '傳送中…' : copy.button);

  async function send() {
    if (state.ask.busy) return;
    const target = state.current;
    state.ask.busy = true;
    btn.disabled = true;
    btn.textContent = '傳送中…';
    try {
      const res = await api('/api/ask', { method: 'POST', body: { id: target.id, text: field.value.trim() } });
      if (state.current?.id === target.id) state.ask.out = res.text;
    } catch (err) {
      toast(err.message, { type: 'error', id: 'ask' });
    } finally {
      state.ask.busy = false;
      renderAsk();
    }
  }

  slot.replaceChildren(
    sectionTitle(copy.title),
    h('div', { class: 'ask-row' }, field, btn),
    state.ask.out ? h('p', { class: 'ask-out', 'aria-live': 'polite' }, state.ask.out) : null,
  );
}

/* =========================================================
   快捷鍵與啟動
   ========================================================= */
document.addEventListener('keydown', (e) => {
  if (e.ctrlKey || e.metaKey || e.altKey) return;
  const typing = e.target.closest('input, textarea, select, [contenteditable="true"]');
  if (typing) return;
  if (e.key === '/') {
    e.preventDefault();
    input.focus();
    input.select();
  } else if ((e.key === 'ArrowLeft' || e.key === 'ArrowRight') && state.current && !state.loading) {
    const id = e.key === 'ArrowLeft' ? state.current.nav.prev : state.current.nav.next;
    if (id) loadPokemon(String(id));
  } else if (e.key === 'r' || e.key === 'R') {
    randomPokemon();
  }
});

loadStatus();
const start = new URL(location.href).searchParams.get('p');
if (start) loadPokemon(start, { push: false });
else view.replaceChildren(emptyState());
