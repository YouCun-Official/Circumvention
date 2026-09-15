import test from 'node:test';
import assert from 'node:assert/strict';
import { articleTextLength, LENGTH_PROFILES } from '../src/services/llm.js';
import { validateRequest } from '../src/pipeline.js';

test('articleTextLength measures publication text and ignores whitespace', () => {
  const article = {
    sections: [{ heading: '研究背景', paragraphs: ['一 二 三'], points: [{ title: '方法', body: '四五' }] }],
    conclusion: ['六 七']
  };
  assert.equal(articleTextLength(article), 13);
});

test('default request uses the reference-sized standard profile and top venues', () => {
  const request = validateRequest({ topic: 'agents', count: 3 });
  assert.equal(request.length, 'standard');
  assert.deepEqual(LENGTH_PROFILES.standard, { min: 1850, max: 2150, target: 2000, label: '标准篇幅' });
  assert.deepEqual(request.venues, ['ICML', 'ICLR', 'AAAI', 'NEURIPS', 'KDD', 'ACL', 'WWW']);
  assert.deepEqual(request.tracks, ['main', 'workshop', 'findings']);
});
