import fs from 'node:fs';
import path from 'node:path';
import { parseArgs } from 'node:util';
import { readSettings } from './config.js';
import { enrichArxiv, normalizePaperInputs } from './services/arxiv.js';
import { extractPdfText } from './services/pdf.js';
import { writeArticle } from './services/llm.js';
import { writeMarkdownPair } from './writer.js';

const { values } = parseArgs({ options: {
  pdf: { type: 'string' }, id: { type: 'string' }, output: { type: 'string' },
  length: { type: 'string', default: 'standard' }
} });
if (!values.pdf || !values.id || !values.output) throw new Error('用法：node src/generate-local.js --pdf 原文.pdf --id arXiv编号 --output 输出目录');
const output = path.resolve(values.output);
fs.mkdirSync(output, { recursive: true });
const log = message => console.log(new Date().toLocaleTimeString('zh-CN'), message);
const [paper] = await enrichArxiv(normalizePaperInputs(values.id), { onLog: log });
const parsed = await extractPdfText(path.resolve(values.pdf));
const article = await writeArticle(readSettings(), paper, parsed.text, [], values.length, log, {
  checkpointFile: path.join(output, 'article.draft.json')
});
const files = writeMarkdownPair(output, { article, paper, figures: [] });
console.log(JSON.stringify({ characters: article.generatedTextCharacters, files }));
