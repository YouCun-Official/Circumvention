import fs from 'node:fs';
import path from 'node:path';
import { readSettings, OUTPUT_DIR } from './config.js';
import { atomicJson } from './utils.js';
import { getJob, updateJob } from './job-store.js';
import { extractPdfText, extractFigures } from './services/pdf.js';
import { uploadFigures } from './services/uploader.js';
import { writeArticle } from './services/llm.js';
import { writeMarkdownPair } from './writer.js';
import { writeHtml, exportPdf } from './render.js';

const id = process.argv[2];
const job = id && getJob(id);
if (!job) throw new Error('用法：node src/rebuild-batch.js 任务编号');
const cfg = readSettings();
const log = message => console.log(new Date().toLocaleTimeString('zh-CN'), message);
for (const item of job.papers) {
  if (item.status !== 'completed') continue;
  const manifestPath = path.join(OUTPUT_DIR, item.files.manifest);
  const folder = path.dirname(manifestPath);
  const data = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
  log(`重新检查配图及导出：${item.title}`);
  const parsed = await extractPdfText(path.join(folder, 'source.pdf'));
  let figures = process.argv.includes('--layout-only')
    ? data.figures.map(figure => ({ ...figure, file: path.join(folder, figure.localFile) }))
    : await extractFigures(path.join(folder, 'source.pdf'), parsed, path.join(folder, 'assets'), cfg, log, job.request.maxFigures);
  figures = await uploadFigures(figures, id, path.basename(folder), cfg, log);
  const article = await writeArticle(cfg, data.paper, parsed.text, figures, job.request.length, log, { checkpointFile: path.join(folder, 'article.draft.json') });
  article.venue = data.paper.verifiedVenue.label;
  const markdown = writeMarkdownPair(folder, { article, paper: data.paper, figures, editor: job.request.editor, reviewer: job.request.reviewer });
  const html = writeHtml(markdown.localFile, path.join(folder, 'article.html'), article.displayTitle);
  data.pdf = await exportPdf(html, path.join(folder, 'article.pdf'), job.request.pdfMode, cfg, log);
  data.article = article;
  data.figures = figures.map(({ file, ...figure }) => ({ ...figure, localFile: path.relative(folder, file).split(path.sep).join('/') }));
  data.length = { profile: job.request.length, articleCharacters: article.generatedTextCharacters, markdownCharacters: fs.readFileSync(markdown.localFile, 'utf8').length };
  data.rebuiltAt = new Date().toISOString();
  atomicJson(manifestPath, data);
  updateJob(id, job => { const paper = job.papers.find(p => p.baseId === item.baseId); Object.assign(paper, { figures: figures.length, articleCharacters: article.generatedTextCharacters, markdownCharacters: data.length.markdownCharacters }); });
  log(`已导出 ${figures.length} 张图片、Markdown 和 PDF`);
}
