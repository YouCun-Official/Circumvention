import test from 'node:test';
import assert from 'node:assert/strict';
import { enrichArxiv, parseArxivAbs } from '../src/services/arxiv.js';

test('arXiv abs HTML metadata is parsed without the rate-limited export API', () => {
  const html = `
    <meta name="citation_title" content="Agent &amp; Game">
    <meta name="citation_author" content="Alice Smith">
    <meta name="citation_author" content="Bob Lee">
    <meta name="citation_date" content="2026/01/02">
    <meta name="citation_arxiv_id" content="2601.12345">
    <meta name="citation_pdf_url" content="http://arxiv.org/pdf/2601.12345">
    <meta name="citation_abstract" content="A strategic agent study.">
    <td class="tablecell comments">Accepted at ICLR 2026</td>
  `;
  const paper = parseArxivAbs(html, '2601.12345');
  assert.equal(paper.title, 'Agent & Game');
  assert.deepEqual(paper.authors, ['Alice Smith', 'Bob Lee']);
  assert.equal(paper.published, '2026-01-02');
  assert.equal(paper.comment, 'Accepted at ICLR 2026');
  assert.equal(paper.pdfUrl, 'https://arxiv.org/pdf/2601.12345');
});

test('arXiv metadata failure falls back to Tavily data instead of aborting the batch', async t => {
  const originalFetch = globalThis.fetch;
  t.after(() => { globalThis.fetch = originalFetch; });
  globalThis.fetch = async () => new Response('Rate exceeded.', { status: 429 });
  const warnings = [];
  const papers = await enrichArxiv([{
    id: '2601.12345', baseId: '2601.12345', title: 'Tavily title', snippets: ['Tavily abstract']
  }], { delayMs: 0, onLog: (message, level) => { if (level === 'warn') warnings.push(message); } });
  assert.equal(papers.length, 1);
  assert.equal(papers[0].title, 'Tavily title');
  assert.equal(papers[0].abstract, 'Tavily abstract');
  assert.match(warnings[0], /使用 Tavily 元数据继续/);
});
