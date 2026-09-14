import test from 'node:test';
import assert from 'node:assert/strict';
import { extractJson, slugify } from '../src/utils.js';
import { extractArxivId } from '../src/services/tavily.js';

test('extractJson handles fenced output and surrounding prose', () => {
  assert.deepEqual(extractJson('```json\n{"ok":true}\n```'), { ok: true });
  assert.deepEqual(extractJson('result: {"items":[1,2]} done'), { items: [1, 2] });
});

test('extractArxivId accepts common arXiv forms', () => {
  assert.equal(extractArxivId('https://arxiv.org/abs/2412.15606v2'), '2412.15606v2');
  assert.equal(extractArxivId('https://arxiv.org/pdf/2602.03828.pdf'), '2602.03828');
  assert.equal(extractArxivId('hep-th/9901001'), 'hep-th/9901001');
});

test('slugify removes Windows-invalid path characters', () => {
  assert.equal(slugify('A: Paper / Test?'), 'A-Paper-Test');
});
