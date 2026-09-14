import test from 'node:test';
import assert from 'node:assert/strict';
import { searchPapers } from '../src/services/tavily.js';

test('Tavily searches once per venue and merges duplicate arXiv results', async t => {
  const originalFetch = globalThis.fetch;
  const queries = [];
  t.after(() => { globalThis.fetch = originalFetch; });
  globalThis.fetch = async (_url, options) => {
    const request = JSON.parse(options.body);
    queries.push(request.query);
    const venue = request.query.includes('ICLR') ? 'ICLR' : 'ACL';
    return new Response(JSON.stringify({ results: [{
      title: 'Shared Paper',
      url: 'https://arxiv.org/abs/2601.12345',
      content: `${venue} 2026 main conference paper`,
      score: 0.9
    }] }), { status: 200, headers: { 'content-type': 'application/json' } });
  };

  const papers = await searchPapers('multimodal agents', 3, ['ICLR', 'ACL'], ['main'], [2026], { tavilyApiKey: 'test' });
  assert.equal(queries.length, 2);
  assert.match(queries[0], /multimodal agents ICLR/);
  assert.match(queries[1], /multimodal agents ACL/);
  assert.equal(papers.length, 1);
  assert.deepEqual(papers[0].venueHints, ['ICLR', 'ACL']);
  assert.equal(papers[0].queryEvidence.length, 2);
  assert.equal(papers[0].appearances, 2);
});
