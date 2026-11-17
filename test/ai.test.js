// AI 判斷搜尋：解析模型回覆、本機篩候選（離線，用假資料）：npm test
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseAiPicks, AI_PICKS } from '../lib/integrations.js';
import { parseDescription, pickCandidates, candidateLine, explainMatch } from '../lib/describe.js';

/* ---------- 解析模型回覆 ---------- */
test('一般 JSON', () => {
  const picks = parseAiPicks('{"matches":[{"dexNo":186,"name":"蚊香蛙皇","en":"Politoed","reason":"綠色的青蛙"}]}');
  assert.deepEqual(picks, [{ dexNo: 186, name: '蚊香蛙皇', en: 'Politoed', reason: '綠色的青蛙' }]);
});

test('```json 區塊與前後多餘文字', () => {
  const picks = parseAiPicks('好的！\n```json\n{"matches":[{"en":"Raichu","dexNo":"26"}]}\n```\n希望有幫助');
  assert.deepEqual(picks, [{ dexNo: 26, name: '', en: 'Raichu', reason: '' }]);
});

test('直接回陣列也接受', () => {
  const picks = parseAiPicks('[{"name":"耿鬼","dexNo":94}]');
  assert.equal(picks[0].name, '耿鬼');
  assert.equal(picks[0].dexNo, 94);
});

test(`最多 ${AI_PICKS} 筆，空的或壞掉的丟掉`, () => {
  const many = Array.from({ length: AI_PICKS + 3 }, (_, i) => ({ en: `Mon${i}`, dexNo: i + 1 }));
  assert.equal(parseAiPicks(JSON.stringify({ matches: [null, {}, ...many] })).length, AI_PICKS);
});

test('中間有一筆亂碼、結尾被截斷 → 撿回其他還能讀的', () => {
  // gpt-oss-20B 實際回過的樣子：第 2 筆的 en 變亂碼、最後一筆沒寫完
  const raw =
    '{"matches":[{"dexNo":5,"name":"火恐龍","en":"Charmeleon","reason":"紅色恐龍"},' +
    '{"dexNo":6,"name":"噴火龍","en":"CharizardWARNපු fabric bed("~/.backends51 ද?","reason":"大型火龍"},' +
    '{"dexNo":219,"name":"熔岩蝸牛","en":"Magcargo","reason":"熔岩"},{"dexNo"';
  assert.deepEqual(parseAiPicks(raw).map((p) => p.name), ['火恐龍', '熔岩蝸牛']);
});

test('不是 JSON 就回空陣列', () => {
  assert.deepEqual(parseAiPicks('我不知道'), []);
  assert.deepEqual(parseAiPicks('{壞掉的'), []);
  assert.deepEqual(parseAiPicks(''), []);
  assert.deepEqual(parseAiPicks('{"matches":[]}'), []);
});

/* ---------- 本機篩候選 ---------- */
const sp = (dexNo, zh, color, types, genus) => ({ id: dexNo, dexNo, zh, color, types, genus, isDefault: true });
const SPECIES = [
  sp(1, '妙蛙種子', 'green', ['grass', 'poison'], '種子寶可夢'),
  sp(3, '妙蛙花', 'green', ['grass', 'poison'], '種子寶可夢'),
  sp(6, '噴火龍', 'red', ['fire', 'flying'], '火焰寶可夢'),
  sp(25, '皮卡丘', 'yellow', ['electric'], '鼠寶可夢'),
  sp(60, '蚊香蝌蚪', 'blue', ['water'], '蝌蚪寶可夢'),
  sp(186, '蚊香蛙皇', 'green', ['water'], '蛙寶可夢'), // PokeAPI 實際的分類就是「蛙寶可夢」
  sp(656, '呱呱泡蛙', 'blue', ['water'], '泡蛙寶可夢'),
  sp(10, '綠毛蟲', 'green', ['bug'], '蟲寶寶寶可夢'),
];
const names = (list) => list.map((e) => e.zh);

test('拆描述：顏色、屬性、剩下的字', () => {
  assert.deepEqual(parseDescription('綠色青蛙'), { colors: ['green'], types: [], chars: ['青', '蛙'] });
  // 「飛行」「火」被當屬性拿掉，剩下的「會的系」都是虛字
  assert.deepEqual(parseDescription('會飛行的火系'), { colors: [], types: ['flying', 'fire'], chars: [] });
  assert.deepEqual(parseDescription('黄色老鼠').colors, ['yellow']); // 簡體也認
});

test('綠色青蛙 → 綠色又是青蛙的排最前面，藍色的蛙也在候選裡', () => {
  const list = pickCandidates(SPECIES, '綠色青蛙');
  assert.equal(list[0].zh, '蚊香蛙皇'); // 綠 +3、「蛙」在分類和名字都有
  assert.ok(names(list).includes('妙蛙種子'));
  assert.ok(names(list).includes('呱呱泡蛙'));
  assert.ok(!names(list).includes('噴火龍'));
});

test('背上有花的青蛙 → 沒有顏色也能靠名字和分類篩到妙蛙花', () => {
  const list = pickCandidates(SPECIES, '背上有花的青蛙');
  assert.equal(list[0].zh, '妙蛙花'); // 花、蛙兩個字都對到
  assert.ok(names(list).includes('蚊香蛙皇'));
});

test('黃色老鼠 → 皮卡丘第一', () => {
  assert.equal(pickCandidates(SPECIES, '黃色老鼠')[0].zh, '皮卡丘');
});

test('什麼都對不到 → 空清單（交給 AI 自己判斷）', () => {
  assert.deepEqual(pickCandidates(SPECIES, '的的的'), []);
});

test('上限', () => {
  assert.equal(pickCandidates(SPECIES, '綠色', 2).length, 2);
});

test('給 AI 看的一行', () => {
  assert.equal(candidateLine(SPECIES[5]), '186 蚊香蛙皇|綠|水|蛙');
});

test('補位的理由', () => {
  assert.equal(explainMatch(SPECIES[5], '綠色青蛙'), '綠色・分類有蛙');
  assert.equal(explainMatch(SPECIES[0], '綠色青蛙'), '綠色・名字有蛙');
  assert.equal(explainMatch(SPECIES[4], '水系'), '水屬性');
  assert.equal(explainMatch(SPECIES[2], '的'), '圖鑑資料相近');
});
