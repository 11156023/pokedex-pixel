// .env 讀取：舊版 Node 沒有 process.loadEnvFile 時的備援解析：npm test
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { parseEnv, loadEnv } from '../lib/env.js';

test('parseEnv：註解、空值、引號、export、行尾註解、CRLF、BOM', () => {
  const text = '﻿# 註解\r\nPORT=3000\r\nAI_PROVIDER=n8n\r\nOPENAI_API_KEY=\r\nexport A="x # 不是註解"\r\nB=\'單引號\'\r\nC=https://h/webhook/x # 行尾註解\r\n壞行\r\n';
  assert.deepEqual(parseEnv(text), {
    PORT: '3000', AI_PROVIDER: 'n8n', OPENAI_API_KEY: '', A: 'x # 不是註解', B: '單引號', C: 'https://h/webhook/x',
  });
});

test('loadEnv：沒有內建 loadEnvFile 時用備援；已存在的環境變數優先', () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'env-'));
  const file = path.join(dir, '.env');
  writeFileSync(file, 'ENV_TEST_A=from-file\nENV_TEST_B=from-file\n');
  const builtin = process.loadEnvFile;
  process.loadEnvFile = undefined; // 模擬 Node 18
  process.env.ENV_TEST_B = 'from-shell';
  try {
    assert.deepEqual(loadEnv(file), { loaded: true, how: 'fallback' });
    assert.equal(process.env.ENV_TEST_A, 'from-file');
    assert.equal(process.env.ENV_TEST_B, 'from-shell');
  } finally {
    process.loadEnvFile = builtin;
    delete process.env.ENV_TEST_A;
    delete process.env.ENV_TEST_B;
  }
  assert.equal(loadEnv(path.join(dir, 'nope')).how, 'missing');
});
