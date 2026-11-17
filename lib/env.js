// 讀 .env：Node 20.12+ 用內建 process.loadEnvFile；更舊的 Node 沒有這個函式，就自己解析（不裝 dotenv）。
// 已經在環境變數裡的值優先（跟 loadEnvFile 一樣），所以 `PORT=4000 npm start` 還是有效。
import { existsSync, readFileSync } from 'node:fs';

/** 解析 .env 文字 → { KEY: value }；支援 export 前綴、單雙引號、行尾 # 註解（引號外） */
export function parseEnv(text) {
  const out = {};
  for (const raw of String(text).replace(/^﻿/, '').split(/\r?\n/)) {
    const m = raw.match(/^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/);
    if (!m) continue;
    let v = m[2].trim();
    const q = v[0];
    if ((q === '"' || q === "'") && v.lastIndexOf(q) > 0) {
      v = v.slice(1, v.lastIndexOf(q));
      if (q === '"') v = v.replace(/\\n/g, '\n');
    } else {
      v = v.replace(/\s+#.*$/, '');
    }
    out[m[1]] = v;
  }
  return out;
}

/** 載入 .env；回傳 { loaded, how, error } 給啟動訊息用 */
export function loadEnv(file) {
  if (!existsSync(file)) return { loaded: false, how: 'missing' };
  try {
    if (typeof process.loadEnvFile === 'function') {
      process.loadEnvFile(file);
      return { loaded: true, how: 'builtin' };
    }
    for (const [k, v] of Object.entries(parseEnv(readFileSync(file, 'utf8')))) {
      if (process.env[k] === undefined) process.env[k] = v;
    }
    return { loaded: true, how: 'fallback' };
  } catch (err) {
    return { loaded: false, how: 'error', error: err.message };
  }
}
