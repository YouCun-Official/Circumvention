import test from 'node:test';
import assert from 'node:assert/strict';
import { rankPapers } from '../src/services/impact.js';

test('manual papers retain their supplied order before ranked search results', () => {
  const ranked = rankPapers([
    { id: 'search', hotScore: 100 },
    { id: 'manual-2', manualIndex: 1, hotScore: 0 },
    { id: 'manual-1', manualIndex: 0, hotScore: 0 },
    { id: 'search-low', hotScore: 1 }
  ]);
  assert.deepEqual(ranked.map(item => item.id), ['manual-1', 'manual-2', 'search', 'search-low']);
});
