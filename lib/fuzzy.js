// 模糊比對：完全相符 > 開頭相符 > 包含 > 依序出現（子序列）> 容錯（打錯字，OSA 編輯距離）
// 中、英、日文都適用；平假名會轉成片假名、全形轉半形、去掉空白與符號。

const CJK = /[぀-ヿ㐀-鿿豈-﫿]/;

const SEPARATORS = /[\s\-_.'’:：·・,，、()（）]+/g;

function base(input) {
  return String(input ?? '')
    .replace(/♀/g, 'f')
    .replace(/♂/g, 'm')
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '') // é → e
    .normalize('NFKC')
    .toLowerCase()
    .replace(/[ぁ-ゖ]/g, (c) => String.fromCharCode(c.charCodeAt(0) + 0x60)); // ひらがな → カタカナ
}

/** 去掉所有空白與符號：「Mr. Mime」→「mrmime」 */
export function norm(input) {
  return base(input).replace(SEPARATORS, '');
}

/** 保留單字邊界：「pikachu-unova-cap」→「pikachu unova cap」。
 *  形態名用這種 key，才不會讓「pikachuu」變成「pikachuunovacap」的開頭。 */
export function normSpaced(input) {
  return base(input).replace(SEPARATORS, ' ').trim();
}

/** Optimal String Alignment 距離（相鄰字對調算 1 次） */
export function osa(a, b) {
  const m = a.length;
  const n = b.length;
  if (!m) return n;
  if (!n) return m;
  const d = Array.from({ length: m + 1 }, (_, i) => {
    const row = new Array(n + 1).fill(0);
    row[0] = i;
    return row;
  });
  for (let j = 0; j <= n; j++) d[0][j] = j;
  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      let v = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + cost);
      if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) {
        v = Math.min(v, d[i - 2][j - 2] + 1);
      }
      d[i][j] = v;
    }
  }
  return d[m][n];
}

/** q 的每個字依序出現在 t 中；回傳跨距（越小越緊密），不符合回 -1 */
function subsequenceSpan(q, t) {
  let start = -1;
  let ti = 0;
  for (const ch of q) {
    const found = t.indexOf(ch, ti);
    if (found < 0) return -1;
    if (start < 0) start = found;
    ti = found + 1;
  }
  return ti - start;
}

function allowedTypos(q, isCjk) {
  const len = q.length;
  if (isCjk) return len >= 6 ? 2 : len >= 3 ? 1 : 0;
  if (len <= 2) return 0;
  if (len <= 4) return 1;
  if (len <= 7) return 2;
  return 3;
}

/**
 * 單一欄位分數（0 = 不相符）。q、t 都要先經過 norm()（或都經過 normSpaced()）。
 * 分數帶：完全 1000｜開頭 850-900｜包含 710-780｜整個名字打錯 1 字 ~700、2 字 ~620｜子序列 450-600｜只打前段又打錯 < 620
 * 用 Array.from 以字元（code point）為單位，中文才不會被拆壞。
 */
export function scoreField(qStr, tStr) {
  if (!qStr || !tStr) return 0;
  if (qStr === tStr) return 1000;
  const q = Array.from(qStr);
  const t = Array.from(tStr);
  const diff = Math.abs(t.length - q.length);

  if (tStr.startsWith(qStr)) return 900 - Math.min(50, diff);

  const isCjk = CJK.test(qStr);
  const minLen = isCjk ? 1 : 2; // 英文只打 1 個字母時只認開頭
  if (q.length < minLen) return 0;

  const idx = tStr.indexOf(qStr);
  if (idx > 0) return 780 - Math.min(40, Array.from(tStr.slice(0, idx)).length * 4) - Math.min(30, diff);

  let best = 0;
  if (q.length >= 2) {
    const span = subsequenceSpan(q, t);
    if (span > 0) best = Math.max(450, 600 - (span - q.length) * 8 - Math.min(30, diff));
  }

  // 兩個中文字打錯一個（耿龜 → 耿鬼）：只跟同樣兩個字的名字比，分數壓低，避免雜訊蓋過正常結果
  if (isCjk && q.length === 2 && t.length === 2 && osa(q, t) === 1) best = Math.max(best, 480);

  const allowed = allowedTypos(q, isCjk);
  if (allowed > 0) {
    const full = osa(q, t); // 整個名字打錯幾個字
    if (full <= allowed) best = Math.max(best, 780 - full * 80 - Math.min(30, diff * 3));
    if (t.length > q.length) {
      const partial = osa(q, t.slice(0, q.length)) + 1; // 只打了前半段又打錯
      if (partial <= allowed) best = Math.max(best, 700 - partial * 80 - Math.min(40, diff * 3));
    }
  }
  return best;
}

/**
 * entries: [{ id, dexNo, isDefault, keys: [norm() 過的字串], spacedKeys?: [normSpaced() 過的字串] , ...其他欄位 }]
 * 回傳依分數排序的前 limit 筆（附 score）
 */
export function fuzzySearch(entries, rawQuery, limit = 12) {
  const raw = String(rawQuery ?? '').trim();
  if (!raw) return [];

  // 編號查詢：25、#25、025、No.25
  const num = raw.match(/^(?:#|no\.?\s*)?0*(\d{1,5})$/i);
  if (num) {
    const digits = num[1];
    const out = [];
    for (const e of entries) {
      const s = String(e.dexNo);
      let score = 0;
      if (e.id === Number(digits)) score = 1000;
      else if (e.isDefault && s.startsWith(digits)) score = 700 - (s.length - digits.length) * 10;
      if (score) out.push({ ...e, score });
    }
    return sortAndCut(out, limit);
  }

  const q = norm(raw);
  const qSpaced = normSpaced(raw);
  if (!q) return [];
  const out = [];
  for (const e of entries) {
    let best = 0;
    for (const k of e.keys) {
      const s = scoreField(q, k);
      if (s > best) best = s;
      if (best === 1000) break;
    }
    for (const k of e.spacedKeys || []) {
      if (best === 1000) break;
      const s = scoreField(qSpaced, k);
      if (s > best) best = s;
    }
    if (best > 0) out.push({ ...e, score: best + (e.isDefault ? 15 : 0) });
  }
  return sortAndCut(out, limit);
}

function sortAndCut(list, limit) {
  list.sort((a, b) => b.score - a.score || a.dexNo - b.dexNo || a.id - b.id);
  return list.slice(0, limit);
}
