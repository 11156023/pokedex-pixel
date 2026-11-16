// 共用小元件：元素建構、API、Toast、狀態畫面、像素窗、分段按鈕、打字機
const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)');

/** h('div', { class: 'x', onclick }, '文字', childEl) — 文字一律走 textContent，不會被當 HTML */
export function h(tag, attrs = {}, ...children) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs || {})) {
    if (v == null || v === false) continue;
    if (k === 'class') el.className = v;
    else if (k === 'style' && typeof v === 'object') {
      for (const [sk, sv] of Object.entries(v)) el.style.setProperty(sk.startsWith('--') ? sk : sk.replace(/[A-Z]/g, (m) => '-' + m.toLowerCase()), sv);
    }
    else if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2), v);
    else if (k === 'dataset') Object.assign(el.dataset, v);
    else el.setAttribute(k, v === true ? '' : v);
  }
  for (const c of children.flat(Infinity)) {
    if (c == null || c === false) continue;
    el.append(c instanceof Node ? c : document.createTextNode(String(c)));
  }
  return el;
}

export async function api(path, { method = 'GET', body, signal } = {}) {
  const res = await fetch(path, {
    method,
    signal,
    headers: body ? { 'content-type': 'application/json' } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const err = new Error(data.error || `HTTP ${res.status}`);
    err.status = res.status;
    throw err;
  }
  return data;
}

/* ---------- Toast：右上、4 秒、無關閉鈕；同 id 只留一則 ---------- */
const TOAST_TITLE = { success: 'OK!', error: 'ERROR', warning: 'CAUTION', info: 'INFO' };
export function toast(message, { type = 'info', id } = {}) {
  const box = document.getElementById('toasts');
  if (id) box.querySelector(`[data-id="${CSS.escape(id)}"]`)?.remove();
  const el = h('div', { class: 'window toast', 'data-type': type, 'data-id': id, role: type === 'error' ? 'alert' : 'status' },
    h('b', {}, TOAST_TITLE[type] || 'INFO'),
    message,
  );
  box.append(el);
  setTimeout(() => {
    el.classList.add('leaving');
    setTimeout(() => el.remove(), 200);
  }, 4000);
}

/* ---------- 狀態畫面（error → loading → empty 的順序由呼叫端決定） ---------- */
export function loadingState(text = '讀取中') {
  return h('div', { class: 'cell state', role: 'status', 'aria-live': 'polite' },
    h('div', { class: 'spinner', 'aria-hidden': 'true' }),
    h('p', {}, text + '…'),
  );
}

export function emptyState() {
  return h('div', { class: 'cell state' },
    h('div', {},
      h('div', { class: 'big blink' }, 'PUSH START'),
      h('p', {}, '輸入名稱或編號開始查詢'),
    ),
  );
}

export function errorState(message, onRetry) {
  return h('div', { class: 'cell state', role: 'alert' },
    h('div', {},
      h('div', { class: 'big' }, 'GAME OVER?'),
      h('p', {}, message),
    ),
    onRetry ? h('button', { class: 'btn', type: 'button', onclick: onRetry }, '重試') : null,
  );
}

/* ---------- 面板內的格子：標題樣式統一，分隔線由 CSS 的 .dex 格線負責 ---------- */
let cellSeq = 0;
export function sectionTitle(title, en, id) {
  return h('h3', { class: 'sec-title', id }, title, en ? h('span', { class: 'en' }, en) : null);
}

export function cell({ title, en, cls = '', id }, ...children) {
  const titleId = title ? `sec-${++cellSeq}` : null;
  return h('section', { class: `cell ${cls}`.trim(), id, 'aria-labelledby': titleId },
    title ? sectionTitle(title, en, titleId) : null,
    ...children,
  );
}

/* ---------- 分段按鈕：role=group + aria-pressed，支援左右鍵 ---------- */
export function segmented({ label, options, value, onChange, cls = '' }) {
  const group = h('div', { class: `seg ${cls}`.trim(), role: 'group', 'aria-label': label });
  const buttons = options.map((opt) =>
    h('button', {
      type: 'button',
      class: 'btn',
      'aria-pressed': String(opt.value === value),
      disabled: opt.disabled || null,
      title: opt.title || null,
      onclick: () => select(opt.value),
    }, opt.label),
  );
  function select(v) {
    buttons.forEach((b, i) => b.setAttribute('aria-pressed', String(options[i].value === v)));
    onChange(v);
  }
  group.addEventListener('keydown', (e) => {
    if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return;
    const enabled = buttons.filter((b) => !b.disabled);
    const i = enabled.indexOf(document.activeElement);
    if (i < 0) return;
    e.preventDefault();
    e.stopPropagation(); // 不要觸發全域的上／下一隻
    const next = enabled[(i + (e.key === 'ArrowRight' ? 1 : enabled.length - 1)) % enabled.length];
    next.focus();
    next.click();
  });
  group.append(...buttons);
  return group;
}

/* ---------- 打字機：setTimeout 逐字，點一下直接顯示全部；背景分頁也會補完 ---------- */
export function typewriter(el, text, speed = 28) {
  const chars = Array.from(text);
  let i = 0;
  let timer = null;
  el.textContent = '';
  el.classList.remove('done');
  const finish = () => {
    clearTimeout(timer);
    el.textContent = text;
    el.classList.add('done');
    el.removeEventListener('click', finish);
  };
  if (reduceMotion.matches || !chars.length) {
    finish();
    return finish;
  }
  const tick = () => {
    i += 1;
    el.textContent = chars.slice(0, i).join('');
    if (i >= chars.length) finish();
    else timer = setTimeout(tick, speed);
  };
  el.addEventListener('click', finish);
  timer = setTimeout(tick, speed);
  return finish;
}

export function typeChip(t, size = '') {
  return h('span', { class: `chip ${size}`.trim(), style: { '--chip-bg': t.color, '--chip-ink': t.ink } }, t.zh);
}

export const pad3 = (n) => String(n).padStart(n > 999 ? 4 : 3, '0');
