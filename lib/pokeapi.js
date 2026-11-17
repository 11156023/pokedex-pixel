// PokeAPI 串接：名稱索引（GraphQL 一次抓全部語言名稱）＋ 單隻詳細資料（REST）＋ 快取
import { readFile, writeFile, mkdir, stat } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { norm, normSpaced, fuzzySearch } from './fuzzy.js';
import { typeInfo, defenseMatchups, STAT_LABELS } from './typechart.js';
import { pickCandidates, explainMatch } from './describe.js';

const REST = 'https://pokeapi.co/api/v2';
const GQL = 'https://graphql.pokeapi.co/v1beta2';
const SPRITE = 'https://raw.githubusercontent.com/PokeAPI/sprites/master/sprites/pokemon';
const LANG = { 'ja-hrkt': 1, 'zh-hant': 4, en: 9, ja: 11, 'zh-hans': 12 };

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const INDEX_FILE = path.join(ROOT, 'data', 'index.json');
const INDEX_MAX_AGE = 7 * 24 * 3600 * 1000; // 名單一週更新一次就夠
const INDEX_VERSION = 2; // 索引欄位有變（v2 加了 color）就 +1，舊的 data/index.json 會自動重抓

export class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

/* ---------- 小型 LRU 快取＋同網址請求合併 ---------- */
class Lru {
  constructor(max, ttlMs) {
    this.max = max;
    this.ttl = ttlMs;
    this.map = new Map();
  }
  get(k) {
    const hit = this.map.get(k);
    if (!hit) return undefined;
    if (Date.now() - hit.t > this.ttl) {
      this.map.delete(k);
      return undefined;
    }
    this.map.delete(k);
    this.map.set(k, hit);
    return hit.v;
  }
  set(k, v) {
    this.map.delete(k);
    this.map.set(k, { v, t: Date.now() });
    if (this.map.size > this.max) this.map.delete(this.map.keys().next().value);
  }
}

const small = new Lru(3000, 24 * 3600 * 1000); // ability / item / evolution-chain
const details = new Lru(400, 12 * 3600 * 1000); // 整理好的單隻資料
const inflight = new Map();

async function fetchJson(url, init = {}) {
  const res = await fetch(url, {
    ...init,
    headers: { accept: 'application/json', 'user-agent': 'pokedex-pixel/1.0 (course demo)', ...init.headers },
    signal: AbortSignal.timeout(15000),
  });
  if (res.status === 404) throw new HttpError(404, '找不到這隻寶可夢');
  if (!res.ok) throw new HttpError(502, `PokeAPI 回應 ${res.status}`);
  return res.json();
}

/** REST GET，可傳完整網址或 /path；cacheable=true 時進小快取 */
function rest(urlOrPath, cacheable = false) {
  const url = urlOrPath.startsWith('http') ? urlOrPath : REST + urlOrPath;
  if (cacheable) {
    const hit = small.get(url);
    if (hit) return Promise.resolve(hit);
  }
  if (inflight.has(url)) return inflight.get(url);
  const p = fetchJson(url)
    .then((json) => {
      if (cacheable) small.set(url, json);
      return json;
    })
    .finally(() => inflight.delete(url));
  inflight.set(url, p);
  return p;
}

const idFromUrl = (url) => Number(String(url).match(/\/(\d+)\/?$/)?.[1]);

/* ---------- 名稱索引 ---------- */
const FORM_WORDS = {
  mega: '超級', gmax: '超極巨化', alola: '阿羅拉', galar: '伽勒爾', hisui: '洗翠', paldea: '帕底亞',
  primal: '原始回歸', origin: '起源', therian: '靈獸', incarnate: '化身', totem: '霸主',
  female: '母', male: '公', x: 'X', y: 'Y', eternamax: '無極巨化', crowned: '劍盾之王',
};

const GQL_QUERY = `query {
  pokemonspecies(order_by: {id: asc}) {
    id name generation_id
    pokemoncolor { name }
    pokemonspeciesnames(where: {language_id: {_in: [4, 9, 11, 12]}}) { name genus language_id }
    pokemons(order_by: {id: asc}) {
      id name is_default
      pokemontypes(order_by: {slot: asc}) { type { name } }
      pokemonforms(limit: 1, order_by: {id: asc}) {
        form_name
        pokemonformnames(where: {language_id: {_eq: 4}}) { name pokemon_name }
      }
    }
  }
}`;

let index = null; // { builtAt, source, entries, byId, bySlug, speciesCount }
let indexPromise = null;
let lastIndexError = null;

function formLabel(slug, speciesSlug) {
  const rest = slug.startsWith(speciesSlug + '-') ? slug.slice(speciesSlug.length + 1) : slug;
  return rest
    .split('-')
    .map((w) => FORM_WORDS[w] || w)
    .join(' ');
}

function titleCase(s) {
  return s.replace(/(^|[\s-])([a-z])/g, (_, a, b) => a + b.toUpperCase());
}

function buildEntriesFromGraphql(data) {
  const entries = [];
  for (const sp of data.pokemonspecies) {
    const names = {};
    let genus = '';
    for (const n of sp.pokemonspeciesnames) {
      if (n.language_id === LANG['zh-hant']) {
        names.zh = n.name;
        genus = n.genus || '';
      } else if (n.language_id === LANG.en) names.en = n.name;
      else if (n.language_id === LANG.ja) names.ja = n.name;
      else if (n.language_id === LANG['zh-hans']) names.zhHans = n.name;
    }
    const speciesZh = names.zh || names.en || sp.name;
    for (const p of sp.pokemons) {
      const types = p.pokemontypes.map((t) => t.type.name);
      let zh = speciesZh;
      let en = names.en || titleCase(sp.name);
      let form = '';
      if (!p.is_default) {
        const fz = p.pokemonforms[0]?.pokemonformnames?.[0];
        const label = formLabel(p.name, sp.name);
        form = label;
        if (fz?.pokemon_name) zh = fz.pokemon_name;
        else if (fz?.name && fz.name.includes(speciesZh)) zh = fz.name;
        else zh = `${speciesZh}（${fz?.name || label}）`;
        en = `${en} ${titleCase(p.name.slice(sp.name.length + 1).replace(/-/g, ' '))}`.trim();
      }
      entries.push({
        id: p.id,
        dexNo: sp.id,
        slug: p.name,
        isDefault: p.is_default,
        zh,
        en,
        ja: names.ja || '',
        zhHans: names.zhHans || '',
        genus,
        color: sp.pokemoncolor?.name || '', // 圖鑑顏色（green、yellow…），AI 判斷搜尋篩候選用
        form,
        gen: sp.generation_id,
        types,
      });
    }
  }
  return entries;
}

async function fetchIndexGraphql() {
  const json = await fetchJson(GQL, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ query: GQL_QUERY }),
  });
  if (json.errors) throw new Error('GraphQL: ' + json.errors.map((e) => e.message).join('; '));
  return buildEntriesFromGraphql(json.data);
}

/** GraphQL 掛掉時的備案：REST 清單只有英文 slug，沒有中文名與屬性 */
async function fetchIndexRest() {
  const list = await fetchJson(`${REST}/pokemon?limit=2000`);
  return list.results.map((r) => {
    const id = idFromUrl(r.url);
    return {
      id, dexNo: id < 10000 ? id : 0, slug: r.name, isDefault: id < 10000,
      zh: '', en: titleCase(r.name.replace(/-/g, ' ')), ja: '', zhHans: '', genus: '', color: '', form: '', gen: 0, types: [],
    };
  });
}

function finalizeIndex(entries, source, builtAt = Date.now()) {
  for (const e of entries) {
    if (e.isDefault) {
      e.keys = [...new Set([e.slug, e.en, e.zh, e.zhHans, e.ja].filter(Boolean).map(norm))];
    } else {
      // 形態：英文名保留單字邊界（見 normSpaced 說明）；中日文本來就沒有空白
      e.keys = [...new Set([e.zh, e.zhHans, e.ja].filter(Boolean).map(norm))];
      e.spacedKeys = [...new Set([e.slug, e.en].filter(Boolean).map(normSpaced))];
    }
  }
  const byId = new Map(entries.map((e) => [e.id, e]));
  const bySlug = new Map(entries.map((e) => [e.slug, e]));
  const speciesCount = entries.reduce((m, e) => (e.isDefault ? Math.max(m, e.dexNo) : m), 0);
  index = { builtAt, source, entries, byId, bySlug, speciesCount };
  return index;
}

async function loadIndexFromDisk() {
  try {
    const st = await stat(INDEX_FILE);
    if (Date.now() - st.mtimeMs > INDEX_MAX_AGE) return null;
    const saved = JSON.parse(await readFile(INDEX_FILE, 'utf8'));
    if (saved.version !== INDEX_VERSION) return null;
    if (!Array.isArray(saved.entries) || saved.entries.length < 100) return null;
    return finalizeIndex(saved.entries, 'cache', saved.builtAt);
  } catch {
    return null;
  }
}

async function buildIndex() {
  const disk = await loadIndexFromDisk();
  if (disk) return disk;
  try {
    const entries = await fetchIndexGraphql();
    await mkdir(path.dirname(INDEX_FILE), { recursive: true });
    const plain = entries.map(({ keys, ...e }) => e);
    await writeFile(INDEX_FILE, JSON.stringify({ version: INDEX_VERSION, builtAt: Date.now(), entries: plain }));
    lastIndexError = null;
    return finalizeIndex(entries, 'graphql');
  } catch (err) {
    console.warn('[index] GraphQL 失敗，改用 REST 英文清單：', err.message);
    lastIndexError = err.message;
    const entries = await fetchIndexRest();
    return finalizeIndex(entries, 'rest'); // 不寫檔，下次啟動再試 GraphQL
  }
}

export function ensureIndex() {
  if (index) return Promise.resolve(index);
  if (!indexPromise) {
    indexPromise = buildIndex().catch((err) => {
      lastIndexError = err.message;
      indexPromise = null; // 下一個請求再試
      throw err;
    });
  }
  return indexPromise;
}

export function indexStatus() {
  return {
    ready: Boolean(index),
    source: index?.source || null,
    count: index?.entries.length || 0,
    species: index?.speciesCount || 0,
    builtAt: index?.builtAt || null,
    error: index ? null : lastIndexError,
  };
}

const spriteUrl = (id) => `${SPRITE}/${id}.png`;

function publicEntry(e) {
  return {
    id: e.id,
    dexNo: e.dexNo,
    slug: e.slug,
    zh: e.zh,
    en: e.en,
    ja: e.ja,
    form: e.form,
    isDefault: e.isDefault,
    types: e.types.map(typeInfo),
    sprite: spriteUrl(e.id),
  };
}

export async function search(q, limit = 12) {
  const idx = await ensureIndex();
  return fuzzySearch(idx.entries, q, limit).map((e) => ({ ...publicEntry(e), score: e.score }));
}

/** AI 判斷搜尋的候選：依描述的顏色／屬性／分類／名字，從圖鑑本尊裡篩出最多 limit 隻 */
export async function aiCandidates(query, limit = 60) {
  const idx = await ensureIndex();
  return pickCandidates(idx.entries.filter((e) => e.isDefault), query, limit);
}

/**
 * AI 回的 [{ dexNo, name, en, reason }] → 圖鑑索引裡真的有的寶可夢（AI 亂編的直接丟掉）。
 * 順序：名字（中／英）完全對得到 → 編號在候選清單裡（AI 照清單抄的）→ 名字打錯一點的模糊比對 → 清單外的編號。
 */
export async function resolvePicks(picks, candidates = []) {
  const idx = await ensureIndex();
  const species = idx.entries.filter((e) => e.isDefault);
  const candidateIds = new Set(candidates.map((c) => c.id));
  const byName = (s) => {
    const k = s && norm(s);
    return k ? species.find((x) => x.keys.includes(k)) || null : null;
  };
  const out = [];
  const seen = new Set();
  for (const p of picks) {
    let e = byName(p.name) || byName(p.en);
    if (!e && candidateIds.has(p.dexNo)) e = idx.byId.get(p.dexNo);
    for (const s of [p.name, p.en]) {
      if (e || !s) continue;
      const [best] = fuzzySearch(species, s, 1);
      if (best && best.score >= 700) e = idx.byId.get(best.id);
    }
    if (!e && p.dexNo > 0) e = idx.byId.get(p.dexNo) || null;
    if (!e || seen.has(e.id)) continue;
    seen.add(e.id);
    out.push({ ...publicEntry(e), reason: p.reason || 'AI 建議', source: 'ai' });
  }
  return out;
}

/** AI 挑的排前面，不足 total 隻（或 AI 沒回應）就用本機候選依分數補滿 */
export function fillTopN(results, candidates, query, total = 5) {
  const out = results.slice(0, total);
  const seen = new Set(out.map((r) => r.id));
  for (const c of candidates) {
    if (out.length >= total) break;
    if (seen.has(c.id)) continue;
    seen.add(c.id);
    out.push({ ...publicEntry(c), reason: explainMatch(c, query), source: 'local' });
  }
  return out;
}

export async function randomId() {
  const idx = await ensureIndex();
  return 1 + Math.floor(Math.random() * idx.speciesCount);
}

/* ---------- 單隻詳細資料 ---------- */
function pickText(entries, field = 'flavor_text') {
  const zh = entries.filter((x) => x.language.name === 'zh-hant');
  const en = entries.filter((x) => x.language.name === 'en');
  const pick = zh.at(-1) || en.at(-1);
  if (!pick) return null;
  const lang = pick.language.name;
  let text = String(pick[field] || '').replace(/[\f­]/g, ' ');
  text = lang === 'en' ? text.replace(/\s+/g, ' ').trim() : text.replace(/\s+/g, '').trim();
  return { text, lang, version: pick.version?.name || pick.version_group?.name || '' };
}

function nameOf(names, fallback) {
  return names.find((n) => n.language.name === 'zh-hant')?.name || names.find((n) => n.language.name === 'en')?.name || fallback;
}

async function abilityInfo(a) {
  try {
    const d = await rest(a.ability.url, true);
    return {
      slug: a.ability.name,
      zh: nameOf(d.names, a.ability.name),
      en: d.names.find((n) => n.language.name === 'en')?.name || a.ability.name,
      hidden: a.is_hidden,
      desc: pickText(d.flavor_text_entries)?.text || '',
    };
  } catch {
    return { slug: a.ability.name, zh: a.ability.name, en: a.ability.name, hidden: a.is_hidden, desc: '' };
  }
}

const TIME_ZH = { day: '白天', night: '夜晚', dusk: '黃昏' };

async function evolutionCondition(details) {
  const d = details?.[0];
  if (!d) return '';
  const parts = [];
  const trig = d.trigger?.name;
  if (d.min_level) parts.push(`Lv.${d.min_level}`);
  if (d.item) {
    const item = await rest(d.item.url, true).catch(() => null);
    parts.push(item ? nameOf(item.names, d.item.name) : d.item.name);
  }
  if (d.held_item) {
    const item = await rest(d.held_item.url, true).catch(() => null);
    parts.push('攜帶' + (item ? nameOf(item.names, d.held_item.name) : d.held_item.name));
  }
  if (d.min_happiness) parts.push('親密度高');
  if (d.min_affection) parts.push('友好度高');
  if (d.known_move_type) parts.push(`學會${typeInfo(d.known_move_type.name).zh}屬性招式`);
  else if (d.known_move) parts.push('學會特定招式');
  if (d.time_of_day) parts.push(TIME_ZH[d.time_of_day] || d.time_of_day);
  if (d.location) parts.push('特定地點');
  if (d.needs_overworld_rain) parts.push('下雨時');
  if (trig === 'trade') parts.unshift('通信交換');
  if (!parts.length) parts.push(trig === 'level-up' ? '升級' : '特殊條件');
  return parts.join('・');
}

async function buildEvolution(chainUrl) {
  const chain = await rest(chainUrl, true);
  const idx = index;
  const stages = [];
  const walk = async (node, depth, from) => {
    const speciesId = idFromUrl(node.species.url);
    const e = idx?.byId.get(speciesId);
    (stages[depth] ||= []).push({
      id: speciesId,
      slug: node.species.name,
      zh: e?.zh || node.species.name,
      en: e?.en || node.species.name,
      from,
      cond: depth === 0 ? '' : await evolutionCondition(node.evolution_details),
      sprite: spriteUrl(speciesId),
    });
    for (const next of node.evolves_to) await walk(next, depth + 1, speciesId);
  };
  await walk(chain.chain, 0, null);
  return stages;
}

function genderText(rate) {
  if (rate < 0) return '無性別';
  const female = (rate / 8) * 100;
  return `♂ ${100 - female}%　♀ ${female}%`;
}

/** key 可以是編號、slug 或任何模糊字串（會先找最接近的一隻） */
export async function getPokemon(key) {
  const raw = String(key ?? '').trim();
  if (!raw) throw new HttpError(400, '請輸入名稱或編號');
  const idx = await ensureIndex().catch(() => null);

  let target = raw.toLowerCase();
  let resolvedFrom = null;
  if (idx) {
    const asNum = /^\d+$/.test(raw) ? Number(raw) : null;
    const hit = asNum ? idx.byId.get(asNum) : idx.bySlug.get(target);
    if (hit) target = String(hit.id);
    else if (!asNum) {
      const [best] = fuzzySearch(idx.entries, raw, 1);
      if (!best) throw new HttpError(404, `找不到「${raw}」`);
      target = String(best.id);
      resolvedFrom = raw;
    }
  }

  const cached = details.get(target);
  if (cached) return resolvedFrom ? { ...cached, resolvedFrom } : cached;

  const p = await rest(`/pokemon/${encodeURIComponent(target)}`);
  const speciesId = idFromUrl(p.species.url);
  const s = await rest(`/pokemon-species/${speciesId}`);
  const [abilities, evolution] = await Promise.all([
    Promise.all(p.abilities.sort((a, b) => a.slot - b.slot).map(abilityInfo)),
    s.evolution_chain ? buildEvolution(s.evolution_chain.url).catch(() => []) : [],
  ]);

  const entry = idx?.byId.get(p.id);
  const typeKeys = p.types.sort((a, b) => a.slot - b.slot).map((t) => t.type.name);
  const stats = p.stats.map((st) => ({
    key: st.stat.name,
    label: STAT_LABELS[st.stat.name] || st.stat.name,
    value: st.base_stat,
  }));
  const zhSpecies = nameOf(s.names, p.name);
  const gen1 = p.sprites.versions?.['generation-i']?.['red-blue'];

  const detail = {
    id: p.id,
    dexNo: speciesId,
    slug: p.name,
    isDefault: p.is_default,
    names: {
      zh: entry?.zh || zhSpecies,
      en: entry?.en || s.names.find((n) => n.language.name === 'en')?.name || p.name,
      ja: s.names.find((n) => n.language.name === 'ja')?.name || '',
    },
    genus: s.genera.find((g) => g.language.name === 'zh-hant')?.genus || s.genera.find((g) => g.language.name === 'en')?.genus || '',
    generation: idFromUrl(s.generation.url),
    types: typeKeys.map(typeInfo),
    height: p.height / 10, // 公尺
    weight: p.weight / 10, // 公斤
    baseExp: p.base_experience,
    stats,
    total: stats.reduce((sum, st) => sum + st.value, 0),
    abilities,
    flavor: pickText(s.flavor_text_entries),
    captureRate: s.capture_rate,
    gender: genderText(s.gender_rate),
    isLegendary: s.is_legendary,
    isMythical: s.is_mythical,
    isBaby: s.is_baby,
    eggGroups: s.egg_groups.map((g) => g.name),
    movesCount: p.moves.length,
    sprites: {
      front: p.sprites.front_default,
      shiny: p.sprites.front_shiny,
      back: p.sprites.back_default,
      backShiny: p.sprites.back_shiny,
      gen1: gen1?.front_transparent || gen1?.front_default || null,
      artwork: p.sprites.other?.['official-artwork']?.front_default || null,
    },
    cries: { legacy: p.cries?.legacy || null, latest: p.cries?.latest || null },
    matchups: Object.fromEntries(Object.entries(defenseMatchups(typeKeys)).map(([k, v]) => [k, v.map(typeInfo)])),
    evolution,
    varieties: s.varieties.map((v) => {
      const id = idFromUrl(v.pokemon.url);
      const e = idx?.byId.get(id);
      return { id, slug: v.pokemon.name, zh: e?.zh || v.pokemon.name, isDefault: v.is_default };
    }),
    nav: {
      prev: speciesId > 1 ? speciesId - 1 : null,
      next: speciesId < (idx?.speciesCount || 1025) ? speciesId + 1 : null,
    },
    source: 'pokeapi.co',
  };

  details.set(String(p.id), detail);
  details.set(p.name, detail);
  return resolvedFrom ? { ...detail, resolvedFrom } : detail;
}

/** 給 AI / n8n 用的精簡摘要（避免把整包資料送出去） */
export function summarize(d) {
  return {
    id: d.id,
    dexNo: d.dexNo,
    slug: d.slug,
    name: d.names.zh,
    nameEn: d.names.en,
    genus: d.genus,
    types: d.types.map((t) => t.zh),
    stats: Object.fromEntries(d.stats.map((s) => [s.label, s.value])),
    total: d.total,
    abilities: d.abilities.map((a) => (a.hidden ? `${a.zh}（隱藏）` : a.zh)),
    weakTo: [...d.matchups.x4.map((t) => `${t.zh}×4`), ...d.matchups.x2.map((t) => `${t.zh}×2`)],
    resists: [...d.matchups.x05, ...d.matchups.x025].map((t) => t.zh),
    immuneTo: d.matchups.x0.map((t) => t.zh),
    heightM: d.height,
    weightKg: d.weight,
    flavor: d.flavor?.text || '',
    evolution: d.evolution.map((stage) => stage.map((n) => n.zh + (n.cond ? `（${n.cond}）` : '')).join(' / ')),
  };
}
