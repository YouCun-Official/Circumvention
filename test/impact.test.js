import test from 'node:test';
import assert from 'node:assert/strict';
import { rankPapers } from '../src/services/impact.js';
import { addImpactSignals } from '../src/services/impact.js';

test('manual papers retain their supplied order before ranked search results', () => {
  const ranked = rankPapers([
    { id: 'search', hotScore: 100 },
    { id: 'manual-2', manualIndex: 1, hotScore: 0 },
    { id: 'manual-1', manualIndex: 0, hotScore: 0 },
    { id: 'search-low', hotScore: 1 }
  ]);
  assert.deepEqual(ranked.map(item => item.id), ['manual-1', 'manual-2', 'search', 'search-low']);
});

test('Semantic Scholar is skipped without an API key', async t => {
  const originalFetch = globalThis.fetch;
  let called = false;
  t.after(() => { globalThis.fetch = originalFetch; });
  globalThis.fetch = async () => { called = true; throw new Error('should not fetch'); };
  const logs = [];
  const papers = await addImpactSignals([{ id: 'x', searchScore: 2.5 }], {}, message => logs.push(message));
  assert.equal(called, false);
  assert.equal(papers[0].hotScore, 2.5);
  assert.match(logs[0], /跳过引用数据/);
});
