// 模糊搜尋排序測試（離線，用假資料）：npm test
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { norm, normSpaced, osa, scoreField, fuzzySearch } from '../lib/fuzzy.js';

const mk = (id, dexNo, slug, zh, en, ja = '', isDefault = true) => {
  const e = { id, dexNo, slug, zh, en, ja, isDefault };
  if (isDefault) e.keys = [slug, en, zh, ja].filter(Boolean).map(norm);
  else {
    e.keys = [zh, ja].filter(Boolean).map(norm);
    e.spacedKeys = [slug, en].map(normSpaced);
  }
  return e;
};

const DATA = [
  mk(1, 1, 'bulbasaur', '妙蛙種子', 'Bulbasaur', 'フシギダネ'),
  mk(6, 6, 'charizard', '噴火龍', 'Charizard', 'リザードン'),
  mk(25, 25, 'pikachu', '皮卡丘', 'Pikachu', 'ピカチュウ'),
  mk(94, 94, 'gengar', '耿鬼', 'Gengar', 'ゲンガー'),
  mk(122, 122, 'mr-mime', '魔牆人偶', 'Mr. Mime', 'バリヤード'),
  mk(172, 172, 'pichu', '皮丘', 'Pichu', 'ピチュー'),
  mk(669, 669, 'flabebe', '花蓓蓓', 'Flabébé', 'フラベベ'),
  mk(10034, 6, 'charizard-mega-x', '超級噴火龍Ｘ', 'Charizard Mega X', '', false),
  mk(10097, 25, 'pikachu-unova-cap', '皮卡丘（合眾帽子）', 'Pikachu Unova Cap', '', false),
];

const top = (q) => fuzzySearch(DATA, q, 3)[0]?.id;

test('正規化：全形、平假名、重音、符號', () => {
  assert.equal(norm('Ｍｒ. Mime'), 'mrmime');
  assert.equal(norm('ぴかちゅう'), 'ピカチュウ');
  assert.equal(norm('Flabébé'), 'flabebe');
  assert.equal(normSpaced('pikachu-unova-cap'), 'pikachu unova cap');
});

test('OSA 距離把相鄰對調算一次', () => {
  assert.equal(osa([...'pikahcu'], [...'pikachu']), 1);
  assert.equal(osa([...'妙娃種子'], [...'妙蛙種子']), 1);
});

test('分數帶順序：完全 > 開頭 > 打錯一字 > 子序列', () => {
  const exact = scoreField('pikachu', 'pikachu');
  const prefix = scoreField('pika', 'pikachu');
  const typo = scoreField('picachu', 'pikachu');
  const subseq = scoreField('pkch', 'pikachu');
  assert.ok(exact > prefix && prefix > typo && typo > subseq && subseq > 0);
});

test('各種打法都找得到', () => {
  assert.equal(top('pikachu'), 25);
  assert.equal(top('picachu'), 25);
  assert.equal(top('pikachuu'), 25); // 不能被「pikachu-unova-cap」的開頭搶走
  assert.equal(top('charzard'), 6);
  assert.equal(top('妙娃種子'), 1);
  assert.equal(top('耿龜'), 94);
  assert.equal(top('ぴかちゅう'), 25);
  assert.equal(top('mrmime'), 122);
  assert.equal(top('flabebe'), 669);
  assert.equal(top('charizard mega'), 10034);
  assert.equal(top('#25'), 25);
  assert.equal(top('025'), 25);
});

test('不相干的字回空陣列', () => {
  assert.deepEqual(fuzzySearch(DATA, 'zzzzqqq'), []);
  assert.deepEqual(fuzzySearch(DATA, '   '), []);
});
