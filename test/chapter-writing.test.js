import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { writeArticle } from '../src/services/llm.js';

test('chapter compression excludes source and checkpoints resume without model calls', async t => {
  const originalFetch = globalThis.fetch;
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'paperflow-chapters-'));
  t.after(() => { globalThis.fetch = originalFetch; fs.rmSync(directory, { recursive: true }); });
  const requests = [];
  const lengths = [900, 456, 600, 580, 360];
  globalThis.fetch = async (_url, init) => {
    const body = JSON.parse(init.body);
    requests.push(body);
    return new Response(JSON.stringify({ choices: [{ message: { content: JSON.stringify({ paragraphs: ['文'.repeat(lengths.shift())] }) } }] }), { headers: { 'content-type': 'application/json' } });
  };
  const options = { checkpointFile: path.join(directory, 'draft.json') };
  const cfg = { llmApiKey: 'test', llmModel: 'test', llmBaseUrl: 'https://example.test/v1' };
  const article = await writeArticle(cfg, { title: 'Paper' }, 'SOURCE_SENTINEL', [], 'standard', () => {}, options);
  assert.ok(article.generatedTextCharacters >= 1850 && article.generatedTextCharacters <= 2150);
  assert.equal(requests.length, 5);
  assert.ok(!JSON.stringify(requests[1]).includes('SOURCE_SENTINEL'));
  await writeArticle(cfg, { title: 'Paper' }, 'SOURCE_SENTINEL', [], 'standard', () => {}, options);
  assert.equal(requests.length, 5);
});
