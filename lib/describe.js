// AI 判斷搜尋的第一步：從描述（「綠色青蛙」）在本機的 PokeAPI 圖鑑資料裡篩出候選，再交給 AI 挑。
// 整份 1025 隻送給 AI 太慢（~1.7 萬 token、30 秒以上），先篩成幾十隻只要 ~1200 token。
import { TYPES } from './typechart.js';

/** PokeAPI 的 10 種圖鑑顏色 → 描述裡可能出現的字（繁／簡／英） */
const COLOR_WORDS = {
  green: ['綠', '绿', 'green'],
  yellow: ['黃', '黄', '金', 'yellow'],
  red: ['紅', '红', 'red'],
  blue: ['藍', '蓝', 'blue'],
  white: ['白', 'white'],
  black: ['黑', 'black'],
  pink: ['粉', 'pink'],
  purple: ['紫', 'purple'],
  brown: ['棕', '褐', '咖啡', 'brown'],
  gray: ['灰', '銀', '银', 'gray', 'grey'],
};
export const COLOR_ZH = {
  green: '綠', yellow: '黃', red: '紅', blue: '藍', white: '白',
  black: '黑', pink: '粉紅', purple: '紫', brown: '棕', gray: '灰',
};

/** 屬性 → 描述裡可能出現的字（繁中名稱＋簡體） */
const TYPE_WORDS = Object.fromEntries(Object.entries(TYPES).map(([k, t]) => [k, [t.zh]]));
const TYPE_EXTRA = {
  electric: ['电'], flying: ['飞行'], dragon: ['龙'], bug: ['虫'], steel: ['钢'], dark: ['恶'],
  ghost: ['幽灵'], fighting: ['格斗'],
};
for (const [k, words] of Object.entries(TYPE_EXTRA)) TYPE_WORDS[k].push(...words);

// 描述裡沒意義的字（不拿去比對分類／名字）
const STOP = new Set(Array.from('的色有是會会很隻只一個个系屬属性寶宝可夢梦上下裡里在像長长得跟和與与那這这種种樣样我找要想'));
const HAN = /[㐀-鿿]/;

/** 把描述拆成 { colors, types, chars }；比對過的顏色、屬性字會從 chars 拿掉，避免重複加分 */
export function parseDescription(query) {
  let rest = String(query || '').toLowerCase();
  const take = (dict) => {
    const hits = [];
    // 長的詞先比（「飛行」要在「行」之前被拿掉）
    const pairs = Object.entries(dict).flatMap(([k, words]) => words.map((w) => [k, w]));
    pairs.sort((a, b) => b[1].length - a[1].length);
    for (const [k, w] of pairs) {
      if (rest.includes(w)) {
        if (!hits.includes(k)) hits.push(k);
        rest = rest.replaceAll(w, ' ');
      }
    }
    return hits;
  };
  const colors = take(COLOR_WORDS);
  const types = take(TYPE_WORDS);
  const chars = [...new Set(Array.from(rest).filter((c) => HAN.test(c) && !STOP.has(c)))];
  return { colors, types, chars };
}

/**
 * species：圖鑑索引裡的本尊（isDefault）。計分：顏色相符 +3、每個屬性相符 +2、
 * 描述的每個字：出現在分類（「青蛙寶可夢」）+2、出現在名字（「妙蛙花」）+1、有對到（不管哪裡）再 +2。
 * 回傳分數最高的 limit 隻。
 */
export function pickCandidates(species, query, limit = 60) {
  const { colors, types, chars } = parseDescription(query);
  const out = [];
  for (const e of species) {
    let score = 0;
    if (e.color && colors.includes(e.color)) score += 3;
    score += 2 * e.types.filter((t) => types.includes(t)).length;
    const genus = (e.genus || '').replace(/寶可夢$/, '');
    const name = `${e.zh || ''}${e.zhHans || ''}`;
    for (const c of chars) {
      if (genus.includes(c)) score += 2;
      if (name.includes(c)) score += 1;
      // 描述的字對到越多種越好：妙蛙花（花＋蛙）要贏過霸王花（只有花、但分類和名字都有）
      if (genus.includes(c) || name.includes(c)) score += 2;
    }
    if (score > 0) out.push({ e, score });
  }
  out.sort((a, b) => b.score - a.score || a.e.dexNo - b.e.dexNo);
  return out.slice(0, limit).map((x) => x.e);
}

/** 本機候選為什麼入選（AI 沒挑滿、或 AI 沒回應時拿來補位）：「綠色・分類有蛙」 */
export function explainMatch(e, query) {
  const { colors, types, chars } = parseDescription(query);
  const parts = [];
  if (e.color && colors.includes(e.color)) parts.push(`${COLOR_ZH[e.color]}色`);
  const t = e.types.filter((x) => types.includes(x)).map((x) => TYPES[x]?.zh || x);
  if (t.length) parts.push(`${t.join('/')}屬性`);
  const genus = (e.genus || '').replace(/寶可夢$/, '');
  const name = `${e.zh || ''}${e.zhHans || ''}`;
  const inGenus = chars.filter((c) => genus.includes(c)).join('');
  const inName = chars.filter((c) => name.includes(c) && !inGenus.includes(c)).join('');
  if (inGenus) parts.push(`分類有${inGenus}`);
  if (inName) parts.push(`名字有${inName}`);
  return parts.join('・') || '圖鑑資料相近';
}

/** 給 AI 看的一行：「186 蚊香蛙皇|綠|水|青蛙」 */
export function candidateLine(e) {
  const types = e.types.map((t) => TYPES[t]?.zh || t).join('/');
  return `${e.dexNo} ${e.zh || e.en}|${COLOR_ZH[e.color] || '?'}|${types}|${(e.genus || '').replace(/寶可夢$/, '')}`;
}
