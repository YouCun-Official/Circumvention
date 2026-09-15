import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { marked } from 'marked';
import { chromium } from 'playwright-core';

export const ARTICLE_CSS = `
@page { margin: 12mm 11mm; }
* { box-sizing: border-box; }
html { background: #eef0f3; }
body {
  margin: 0;
  color: #2b2b2b;
  background: #eef0f3;
  font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", "PingFang SC", "Hiragino Sans GB", "Microsoft YaHei", Arial, sans-serif;
  -webkit-font-smoothing: antialiased;
}
.paper {
  width: 100%;
  max-width: 760px;
  min-height: 100vh;
  margin: 0 auto;
  padding: 44px 54px 54px;
  background: white;
  font-size: 16px;
  line-height: 1.88;
  letter-spacing: .025em;
  overflow-wrap: anywhere;
}
p { margin: 0 0 20px; text-align: justify; }
.paper > p:first-child { margin-bottom: 12px; }
strong { color: #214d72; font-weight: 700; }
.section-heading > strong {
  display: inline-block;
  margin: 21px 0 1px;
  padding: 1px 11px 2px;
  color: white;
  background: #315f83;
  border-radius: 2px;
  letter-spacing: .04em;
}
.article-title > strong {
  display: block;
  margin: 0 0 17px;
  padding: 0 0 12px;
  color: #183f61;
  background: transparent;
  border-bottom: 2px solid #315f83;
  border-radius: 0;
  font-size: 24px;
  line-height: 1.45;
}
ul, ol { margin: 4px 0 22px; padding-left: 1.4em; }
li { margin: 9px 0; padding-left: .2em; }
img { display: block; max-width: 100%; height: auto; margin: 0 auto; border-radius: 2px; }
img + br { display: none; }
figure { margin: 27px 0 23px; break-inside: avoid; }
figcaption { margin-top: 8px; color: #63717a; font-size: 13px; line-height: 1.65; text-align: center; }
a { color: #315f83; text-decoration: none; word-break: break-all; }
hr { height: 1px; margin: 34px 0 18px; border: 0; background: #d8dde2; }
blockquote { margin: 18px 0; padding: 12px 17px; color: #526474; background: #f5f8fa; border-left: 3px solid #6f95b4; }
@media print {
  html, body { background: white; }
  .paper { max-width: none; padding: 0; }
  figure img { max-height: 220mm; object-fit: contain; }
  img, li, blockquote, figure { break-inside: avoid; }
  .section-heading { break-after: avoid; }
}
`;

export function markdownToHtml(markdown, title = '论文分享') {
  marked.setOptions({ gfm: true, breaks: false });
  let body = marked.parse(markdown);
  let firstStandalone = true;
  body = body.replace(/<p><strong>([^<]*)<\/strong>(:)?<\/p>/g, (all, inner, colon) => {
    const plain = inner.replace(/<[^>]+>/g, '').trim();
    if (firstStandalone) {
      firstStandalone = false;
      return `<p class="article-title"><strong>${inner}</strong></p>`;
    }
    if (/^(?:论文标题|会议\/期刊)\s*[:：]/.test(plain)) return `<p class="article-meta"><strong>${inner}</strong>${colon || ''}</p>`;
    return `<p class="section-heading"><strong>${inner}</strong>${colon || ''}</p>`;
  });
  body = body.replace(/<p><img ([\s\S]*?)><\/p>\s*<p>图[:：]\s*([\s\S]*?)<\/p>/g, '<figure><img $1><figcaption>图：$2</figcaption></figure>');
  return `<!doctype html>
<html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${String(title).replace(/[<>&]/g, '')}</title><style>${ARTICLE_CSS}</style></head>
<body><article class="paper">${body}</article></body></html>`;
}

export function writeHtml(markdownFile, htmlFile, title) {
  const markdown = fs.readFileSync(markdownFile, 'utf8');
  fs.writeFileSync(htmlFile, markdownToHtml(markdown, title), 'utf8');
  return htmlFile;
}

export function findBrowser(explicit = '') {
  const candidates = [
    explicit,
    process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE,
    'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
    'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
    path.join(process.env.LOCALAPPDATA || '', 'Microsoft', 'Edge', 'Application', 'msedge.exe'),
    'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
    'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
    path.join(process.env.LOCALAPPDATA || '', 'Google', 'Chrome', 'Application', 'chrome.exe')
  ].filter(Boolean);
  return candidates.find(file => fs.existsSync(file)) || '';
}

export async function exportPdf(htmlFile, pdfFile, requestedMode, cfg, onLog = () => {}) {
  const executablePath = findBrowser(cfg.browserExecutable);
  if (!executablePath) throw new Error('未找到 Edge/Chrome。请在设置中填写浏览器程序路径。');
  const browser = await chromium.launch({ executablePath, headless: true });
  try {
    const page = await browser.newPage({ viewport: { width: 760, height: 1000 }, deviceScaleFactor: 1 });
    await page.goto(pathToFileURL(htmlFile).href, { waitUntil: 'load' });
    await page.evaluate(async () => {
      await document.fonts.ready;
      await Promise.all([...document.images].map(img => img.complete ? Promise.resolve() : new Promise(resolve => {
        img.addEventListener('load', resolve, { once: true });
        img.addEventListener('error', resolve, { once: true });
      })));
    });
    let actualMode = requestedMode === 'long' ? 'long' : 'paged';
    if (actualMode === 'long') {
      await page.addStyleTag({ content: '@page { margin: 0; } @media print { .paper { padding: 44px 54px 54px; } }' });
      const height = await page.locator('.paper').evaluate(element => Math.ceil(element.scrollHeight + 4));
      if (height <= 18000) {
        await page.pdf({ path: pdfFile, width: '124mm', height: `${height}px`, printBackground: true, margin: { top: '0', right: '0', bottom: '0', left: '0' } });
      } else {
        actualMode = 'paged';
        onLog(`文章高度 ${height}px 超过单页限制，已自动改用 A4 分页 PDF。`, 'warn');
      }
    }
    if (actualMode === 'paged') {
      await page.pdf({ path: pdfFile, format: 'A4', printBackground: true, preferCSSPageSize: false, margin: { top: '12mm', right: '11mm', bottom: '12mm', left: '11mm' } });
    }
    return { requestedMode, actualMode, browser: executablePath };
  } finally {
    await browser.close();
  }
}
