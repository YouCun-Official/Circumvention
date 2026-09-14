import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { renderMarkdown } from '../src/writer.js';
import { markdownToHtml } from '../src/render.js';

const paper = { title: 'A Paper', absUrl: 'https://arxiv.org/abs/1234.56789', journalRef: '' };
const article = {
  displayTitle: '演示', venue: 'arXiv 2026',
  sections: [
    { heading: '研究背景', paragraphs: ['第一段。'], figureIds: [] },
    { heading: '技术架构', paragraphs: ['第二段。'], points: [{ title: '组件', body: '说明。' }], figureIds: ['fig-01'] },
    { heading: '模型表现', paragraphs: ['第三段。'], figureIds: [] }
  ],
  figureCaptions: { 'fig-01': '中文图注' }, conclusion: ['结论段。']
};

test('writer follows the mdnice pseudo-heading template', () => {
  const markdown = renderMarkdown({
    article, paper, editor: '编辑', reviewer: '', markdownDir: 'C:\\out',
    figures: [{ id: 'fig-01', file: path.join('C:\\out', 'assets', 'fig-01.png'), caption: 'original' }]
  });
  assert.match(markdown, /^\*\*论文分享\|演示\*\*/);
  assert.match(markdown, /\*\*研究背景\*\*/);
  assert.match(markdown, /  - \*\*组件\*\*: 说明。/);
  assert.match(markdown, /!\[\]\(assets\/fig-01\.png\)/);
  assert.match(markdown, /图：中文图注/);
  assert.match(markdown, /编辑 \| 编辑/);
});

test('HTML includes the fixed WeChat article theme', () => {
  const html = markdownToHtml('**论文分享|演示**\n\n正文');
  assert.match(html, /class="paper"/);
  assert.match(html, /max-width: 760px/);
  assert.match(html, /论文分享\|演示/);
});
