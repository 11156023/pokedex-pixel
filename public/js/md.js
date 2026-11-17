// 迷你 Markdown：AI 回答用。先 parse 成區塊（純資料，可以在 Node 測），再用 DOM 節點組出來。
// 不用 innerHTML：AI 回的 <script>、<img onerror> 一律當純文字。
// 支援：# 標題、段落、- / * / ・ / 1. 條列（可縮排一層巢狀）、> 引言、``` 程式碼、表格、---、
//       行內 **粗體**、*斜體*、`程式碼`、~~刪除線~~、[文字](https://…)

const RE = {
  fence: /^\s*```/,
  heading: /^\s*(#{1,6})\s+(.*?)\s*#*\s*$/,
  hr: /^\s*([-*_])(\s*\1){2,}\s*$/,
  quote: /^\s*>\s?(.*)$/,
  item: /^(\s*)(?:([-*+]|\d+[.)])\s+|([・•])\s*)(.*)$/, // 「・」「•」後面可以不空格
  tableRow: /^\s*\|.*\|\s*$/,
  tableSep: /^\s*\|?\s*:?-{2,}:?\s*(\|\s*:?-{2,}:?\s*)*\|?\s*$/,
};

const cells = (line) => line.trim().replace(/^\||\|$/g, '').split('|').map((c) => c.trim());

/** 文字 → 區塊陣列 [{ type, ... }] */
export function parseMarkdown(src) {
  const lines = String(src ?? '').replace(/\r\n?/g, '\n').split('\n');
  const blocks = [];
  let i = 0;
  while (i < lines.length) {
    const line = lines[i];
    if (!line.trim()) { i++; continue; }

    if (RE.fence.test(line)) {
      const code = [];
      for (i++; i < lines.length && !RE.fence.test(lines[i]); i++) code.push(lines[i]);
      i++; // 收尾的 ```（沒有也沒關係）
      blocks.push({ type: 'code', text: code.join('\n') });
      continue;
    }
    let m;
    if ((m = line.match(RE.heading))) {
      blocks.push({ type: 'heading', level: m[1].length, text: m[2] });
      i++;
      continue;
    }
    if (RE.hr.test(line)) {
      blocks.push({ type: 'hr' });
      i++;
      continue;
    }
    if (RE.tableRow.test(line) && RE.tableSep.test(lines[i + 1] || '')) {
      const head = cells(line);
      const rows = [];
      for (i += 2; i < lines.length && RE.tableRow.test(lines[i]); i++) rows.push(cells(lines[i]));
      blocks.push({ type: 'table', head, rows });
      continue;
    }
    if (RE.quote.test(line)) {
      const quote = [];
      for (; i < lines.length && RE.quote.test(lines[i]); i++) quote.push(lines[i].match(RE.quote)[1]);
      blocks.push({ type: 'quote', blocks: parseMarkdown(quote.join('\n')) });
      continue;
    }
    if (RE.item.test(line)) {
      const items = [];
      for (; i < lines.length; i++) {
        const l = lines[i];
        const it = l.match(RE.item);
        if (it) {
          const indent = it[1].replace(/\t/g, '  ').length;
          const ordered = /\d/.test(it[2] || '');
          if (items.length && indent <= items[0].indent && ordered !== items[0].ordered) break; // 換成另一種清單
          items.push({ indent, ordered, text: it[4] });
        }
        else if (l.trim() && /^\s+/.test(l) && items.length) items.at(-1).text += '\n' + l.trim(); // 項目換行接續
        else break;
      }
      blocks.push(buildList(items));
      continue;
    }
    const para = [];
    for (; i < lines.length && lines[i].trim(); i++) {
      const l = lines[i];
      const tableStart = RE.tableRow.test(l) && RE.tableSep.test(lines[i + 1] || '');
      if (para.length && (tableStart || RE.fence.test(l) || RE.heading.test(l) || RE.item.test(l) || RE.quote.test(l) || RE.hr.test(l))) break;
      para.push(l.trim());
    }
    blocks.push({ type: 'para', text: para.join('\n') });
  }
  return blocks;
}

/** 平的項目（帶縮排）→ 巢狀 list：比第一項縮排多的都歸到上一項底下 */
function buildList(items) {
  const base = items[0].indent;
  const list = { type: 'list', ordered: items[0].ordered, items: [] };
  for (let k = 0; k < items.length; k++) {
    const it = items[k];
    if (it.indent > base && list.items.length) {
      const sub = [];
      while (k < items.length && items[k].indent > base) sub.push(items[k++]);
      k--;
      list.items.at(-1).children = buildList(sub);
    } else {
      list.items.push({ text: it.text, children: null });
    }
  }
  return list;
}

/** 行內：回傳 [字串 | { tag, children } | { tag:'a', href, children }] */
export function parseInline(text) {
  const out = [];
  const re = /`([^`]+)`|\*\*(.+?)\*\*|__(.+?)__|~~(.+?)~~|(?<![\w*])\*(?![\s*])(.+?)(?<!\s)\*(?!\w)|\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/g;
  let last = 0;
  let m;
  while ((m = re.exec(text))) {
    if (m.index > last) out.push(text.slice(last, m.index));
    if (m[1] != null) out.push({ tag: 'code', children: [m[1]] });
    else if (m[2] != null || m[3] != null) out.push({ tag: 'strong', children: parseInline(m[2] ?? m[3]) });
    else if (m[4] != null) out.push({ tag: 'del', children: parseInline(m[4]) });
    else if (m[5] != null) out.push({ tag: 'em', children: parseInline(m[5]) });
    else out.push({ tag: 'a', href: m[7], children: parseInline(m[6]) });
    last = re.lastIndex;
  }
  if (last < text.length) out.push(text.slice(last));
  return out;
}

/* ---------- DOM ---------- */
function el(tag, ...children) {
  const node = document.createElement(tag);
  node.append(...children.flat());
  return node;
}

function inline(text) {
  const nodes = [];
  const lines = String(text).split('\n');
  lines.forEach((line, n) => {
    if (n) nodes.push(document.createElement('br'));
    for (const t of parseInline(line)) nodes.push(inlineNode(t));
  });
  return nodes;
}

function inlineNode(t) {
  if (typeof t === 'string') return document.createTextNode(t);
  const node = el(t.tag, ...t.children.map(inlineNode));
  if (t.tag === 'a') {
    node.href = t.href;
    node.target = '_blank';
    node.rel = 'noopener noreferrer';
  }
  return node;
}

function listNode(list) {
  return el(list.ordered ? 'ol' : 'ul',
    list.items.map((it) => el('li', ...inline(it.text), it.children ? [listNode(it.children)] : [])));
}

function blockNode(b) {
  switch (b.type) {
    case 'heading': return el(`h${Math.min(b.level + 3, 6)}`, ...inline(b.text)); // 對話框裡的標題壓小：# → h4
    case 'para': return el('p', ...inline(b.text));
    case 'list': return listNode(b);
    case 'quote': return el('blockquote', b.blocks.map(blockNode));
    case 'code': return el('pre', el('code', b.text));
    case 'hr': return document.createElement('hr');
    case 'table':
      return el('div', el('table',
        el('thead', el('tr', b.head.map((c) => el('th', ...inline(c))))),
        el('tbody', b.rows.map((r) => el('tr', b.head.map((_, k) => el('td', ...inline(r[k] ?? '')))))),
      ));
    default: return document.createTextNode('');
  }
}

/** Markdown 文字 → DocumentFragment */
export function renderMarkdown(src) {
  const frag = document.createDocumentFragment();
  for (const b of parseMarkdown(src)) {
    const node = blockNode(b);
    if (b.type === 'table') node.className = 'md-table';
    frag.append(node);
  }
  return frag;
}
