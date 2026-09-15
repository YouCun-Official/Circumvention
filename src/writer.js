import fs from 'node:fs';
import path from 'node:path';
import { posixRelative } from './utils.js';

function text(value) {
  return String(value || '').replace(/\r/g, '').trim();
}

function paragraph(value) {
  return text(value).replace(/\n+/g, ' ');
}

function figureMarkdown(figure, article, markdownDir, usePublic) {
  const source = usePublic && figure.publicUrl ? figure.publicUrl : posixRelative(markdownDir, figure.file);
  const caption = article.figureCaptions?.[figure.id] || figure.caption || figure.id;
  return `![](${source})\n\n图：${paragraph(caption)}`;
}

export function renderMarkdown({ article, paper, figures, editor = '', reviewer = '', markdownDir, usePublic = false }) {
  const byId = new Map(figures.map(item => [item.id, item]));
  const used = new Set();
  const lines = [
    `**论文分享|${paragraph(article.displayTitle || paper.title)}**`,
    '',
    `**论文标题: ${paragraph(paper.title)}**`,
    '',
    `**会议/期刊: ${paragraph(article.venue || paper.journalRef || 'arXiv')}**`,
    '',
    `**论文链接:** [**${paper.absUrl}**](${paper.absUrl})`,
    ''
  ];

  for (const section of article.sections || []) {
    const heading = paragraph(section.heading);
    if (!heading) continue;
    lines.push(`**${heading}**`, '');
    for (const item of section.paragraphs || []) {
      const value = paragraph(item);
      if (value) lines.push(value, '');
    }
    for (const point of section.points || []) {
      const title = paragraph(point.title);
      const body = paragraph(point.body);
      if (body) lines.push(`  - ${title ? `**${title}**: ` : ''}${body}`, '');
    }
    for (const item of section.numberedItems || []) {
      const title = paragraph(item.title);
      const body = paragraph(item.body);
      if (body) lines.push(`${lines.filter(x => /^\d+\.  /.test(x)).length + 1}.  ${title ? `**${title}**: ` : ''}${body}`, '');
    }
    for (const id of section.figureIds || []) {
      const figure = byId.get(id);
      if (!figure || used.has(id)) continue;
      lines.push('', figureMarkdown(figure, article, markdownDir, usePublic), '');
      used.add(id);
    }
  }

  if ((article.conclusion || []).length) {
    lines.push('**结论**:', '');
    for (const item of article.conclusion) {
      const value = paragraph(item);
      if (value) lines.push(value, '');
    }
  }

  lines.push('---', `审核 | ${paragraph(reviewer)}`, '', `编辑 | ${paragraph(editor)}`, '');
  return lines.join('\n').replace(/\n{4,}/g, '\n\n\n');
}

export function writeMarkdownPair(outputDir, input) {
  const localFile = path.join(outputDir, 'article.local.md');
  const publicFile = path.join(outputDir, 'article.mdnice.md');
  const localMarkdown = renderMarkdown({ ...input, markdownDir: outputDir, usePublic: false }).replace(/\n+$/, '');
  const publicMarkdown = renderMarkdown({ ...input, markdownDir: outputDir, usePublic: true }).replace(/\n+$/, '');
  fs.writeFileSync(localFile, `${localMarkdown}\n`, 'utf8');
  fs.writeFileSync(publicFile, `${publicMarkdown}\n`, 'utf8');
  return { localFile, publicFile };
}
