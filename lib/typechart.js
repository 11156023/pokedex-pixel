// 屬性中文名、顏色（取自 NES 2C02 調色盤）與相剋表（第 6 世代起的 18 屬性）
export const TYPES = {
  normal:   { zh: '一般',   color: '#BCBCBC', ink: '#000' },
  fire:     { zh: '火',     color: '#F83800', ink: '#FCFCFC' },
  water:    { zh: '水',     color: '#0078F8', ink: '#FCFCFC' },
  electric: { zh: '電',     color: '#F8B800', ink: '#000' },
  grass:    { zh: '草',     color: '#00B800', ink: '#FCFCFC' },
  ice:      { zh: '冰',     color: '#3CBCFC', ink: '#000' },
  fighting: { zh: '格鬥',   color: '#A81000', ink: '#FCFCFC' },
  poison:   { zh: '毒',     color: '#940084', ink: '#FCFCFC' },
  ground:   { zh: '地面',   color: '#FCA044', ink: '#000' },
  flying:   { zh: '飛行',   color: '#6888FC', ink: '#FCFCFC' },
  psychic:  { zh: '超能力', color: '#F85898', ink: '#FCFCFC' },
  bug:      { zh: '蟲',     color: '#B8F818', ink: '#000' },
  rock:     { zh: '岩石',   color: '#AC7C00', ink: '#FCFCFC' },
  ghost:    { zh: '幽靈',   color: '#4428BC', ink: '#FCFCFC' },
  dragon:   { zh: '龍',     color: '#6844FC', ink: '#FCFCFC' },
  dark:     { zh: '惡',     color: '#503000', ink: '#FCFCFC' },
  steel:    { zh: '鋼',     color: '#B8B8F8', ink: '#000' },
  fairy:    { zh: '妖精',   color: '#F8B8F8', ink: '#000' },
};

// 攻擊方 → { 效果絕佳(×2), 效果不好(×½), 沒有效果(×0) }
const ATTACK = {
  normal:   { x2: [], x05: ['rock', 'steel'], x0: ['ghost'] },
  fire:     { x2: ['grass', 'ice', 'bug', 'steel'], x05: ['fire', 'water', 'rock', 'dragon'], x0: [] },
  water:    { x2: ['fire', 'ground', 'rock'], x05: ['water', 'grass', 'dragon'], x0: [] },
  electric: { x2: ['water', 'flying'], x05: ['electric', 'grass', 'dragon'], x0: ['ground'] },
  grass:    { x2: ['water', 'ground', 'rock'], x05: ['fire', 'grass', 'poison', 'flying', 'bug', 'dragon', 'steel'], x0: [] },
  ice:      { x2: ['grass', 'ground', 'flying', 'dragon'], x05: ['fire', 'water', 'ice', 'steel'], x0: [] },
  fighting: { x2: ['normal', 'ice', 'rock', 'dark', 'steel'], x05: ['poison', 'flying', 'psychic', 'bug', 'fairy'], x0: ['ghost'] },
  poison:   { x2: ['grass', 'fairy'], x05: ['poison', 'ground', 'rock', 'ghost'], x0: ['steel'] },
  ground:   { x2: ['fire', 'electric', 'poison', 'rock', 'steel'], x05: ['grass', 'bug'], x0: ['flying'] },
  flying:   { x2: ['grass', 'fighting', 'bug'], x05: ['electric', 'rock', 'steel'], x0: [] },
  psychic:  { x2: ['fighting', 'poison'], x05: ['psychic', 'steel'], x0: ['dark'] },
  bug:      { x2: ['grass', 'psychic', 'dark'], x05: ['fire', 'fighting', 'poison', 'flying', 'ghost', 'steel', 'fairy'], x0: [] },
  rock:     { x2: ['fire', 'ice', 'flying', 'bug'], x05: ['fighting', 'ground', 'steel'], x0: [] },
  ghost:    { x2: ['psychic', 'ghost'], x05: ['dark'], x0: ['normal'] },
  dragon:   { x2: ['dragon'], x05: ['steel'], x0: ['fairy'] },
  dark:     { x2: ['psychic', 'ghost'], x05: ['fighting', 'dark', 'fairy'], x0: [] },
  steel:    { x2: ['ice', 'rock', 'fairy'], x05: ['fire', 'water', 'electric', 'steel'], x0: [] },
  fairy:    { x2: ['fighting', 'dragon', 'dark'], x05: ['fire', 'poison', 'steel'], x0: [] },
};

function multiplier(attack, defend) {
  const row = ATTACK[attack];
  if (!row) return 1;
  if (row.x0.includes(defend)) return 0;
  if (row.x2.includes(defend)) return 2;
  if (row.x05.includes(defend)) return 0.5;
  return 1;
}

/** 防守方屬性組合 → 各攻擊屬性的倍率分組（未計特性，例如飄浮） */
export function defenseMatchups(defTypes) {
  const groups = { x4: [], x2: [], x05: [], x025: [], x0: [] };
  for (const atk of Object.keys(ATTACK)) {
    const m = defTypes.reduce((acc, d) => acc * multiplier(atk, d), 1);
    if (m === 4) groups.x4.push(atk);
    else if (m === 2) groups.x2.push(atk);
    else if (m === 0.5) groups.x05.push(atk);
    else if (m === 0.25) groups.x025.push(atk);
    else if (m === 0) groups.x0.push(atk);
  }
  return groups;
}

export function typeInfo(key) {
  const t = TYPES[key] || { zh: key, color: '#7C7C7C', ink: '#FCFCFC' };
  return { key, ...t };
}

export const STAT_LABELS = {
  hp: 'HP',
  attack: '攻擊',
  defense: '防禦',
  'special-attack': '特攻',
  'special-defense': '特防',
  speed: '速度',
};
