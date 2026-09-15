import fs from 'node:fs';
import path from 'node:path';
import { OUTPUT_DIR, readSettings } from './config.js';
import { getJob, logJob, updateJob } from './job-store.js';
import { atomicJson, mapLimit, slugify } from './utils.js';
import { normalizePaperInputs, enrichArxiv, downloadPaper } from './services/arxiv.js';
import { searchPapers } from './services/tavily.js';
import { addImpactSignals, rankPapers } from './services/impact.js';
import { parseTracks, parseVenues, parseYears, verifyVenue } from './services/venues.js';
import { extractPdfText, extractFigures } from './services/pdf.js';
import { uploadFigures } from './services/uploader.js';
import { LENGTH_PROFILES, writeArticle } from './services/llm.js';
import { writeMarkdownPair } from './writer.js';
import { exportPdf, writeHtml } from './render.js';

function uniqueCandidates(items) {
  const map = new Map();
  for (const item of items) {
    const old = map.get(item.baseId);
    map.set(item.baseId, old ? {
      ...item,
      ...old,
      snippets: [...new Set([...(old.snippets || []), ...(item.snippets || [])])],
      venueHints: [...new Set([...(old.venueHints || []), ...(item.venueHints || [])])],
      appearances: Math.max(old.appearances || 0, item.appearances || 0),
      searchScore: Number(old.searchScore || 0) + Number(item.searchScore || 0)
    } : item);
  }
  return [...map.values()];
}

function paperPatch(jobId, baseId, patch) {
  updateJob(jobId, job => {
    const index = job.papers.findIndex(item => item.baseId === baseId);
    if (index >= 0) job.papers[index] = { ...job.papers[index], ...patch, updatedAt: new Date().toISOString() };
  });
}

function jobLogger(jobId, onEvent = () => {}) {
  return (message, level = 'info') => {
    logJob(jobId, message, level);
    onEvent({ type: 'log', at: new Date().toISOString(), level, message });
  };
}

function relativeOutput(file) {
  return path.relative(OUTPUT_DIR, file).split(path.sep).join('/');
}

export function validateRequest(request) {
  const topic = String(request.topic || '').trim();
  const urls = String(request.paperUrls || '').trim();
  if (!topic && !urls) throw new Error('请输入 --topic 或通过 --urls 指定至少一篇 arXiv 论文。');
  const count = Math.min(20, Math.max(1, Number(request.count || 3)));
  const length = LENGTH_PROFILES[request.length] ? request.length : 'standard';
  return {
    ...request,
    topic,
    paperUrls: urls,
    count,
    venues: parseVenues(request.venues),
    tracks: parseTracks(request.tracks),
    years: parseYears(request.years),
    pdfMode: request.pdfMode === 'long' ? 'long' : 'paged',
    length,
    maxFigures: Math.min(10, Math.max(0, Number(request.maxFigures ?? 5))),
    editor: String(request.editor || '').trim(),
    reviewer: String(request.reviewer || '').trim()
  };
}

async function processPaper(jobId, paper, request, cfg, batchDir, onEvent) {
  const log = jobLogger(jobId, onEvent);
  const paperSlug = slugify(`${paper.id}-${paper.title}`);
  const paperDir = path.join(batchDir, paperSlug);
  const assetsDir = path.join(paperDir, 'assets');
  fs.mkdirSync(assetsDir, { recursive: true });
  paperPatch(jobId, paper.baseId, { status: 'running', phase: '下载论文', outputSlug: paperSlug });
  try {
    const sourcePdf = path.join(paperDir, 'source.pdf');
    log(`[${paper.title}] 下载 PDF`);
    await downloadPaper(paper, sourcePdf);

    paperPatch(jobId, paper.baseId, { phase: '解析正文' });
    log(`[${paper.title}] 解析正文与图注`);
    const parsed = await extractPdfText(sourcePdf);
    if (parsed.text.length < 500) throw new Error('PDF 可提取文本过少，可能是扫描件或受保护文件。');

    paperPatch(jobId, paper.baseId, { phase: '提取配图' });
    let figures = await extractFigures(sourcePdf, parsed, assetsDir, cfg, log, request.maxFigures);
    figures = await uploadFigures(figures, jobId, paperSlug, cfg, log);

    paperPatch(jobId, paper.baseId, { phase: '生成解读' });
    log(`[${paper.title}] 生成 ${LENGTH_PROFILES[request.length].label}中文解读`);
    const article = await writeArticle(cfg, paper, parsed.text, figures, request.length, log, { checkpointFile: path.join(paperDir, 'article.draft.json') });
    article.venue = paper.verifiedVenue.label;

    paperPatch(jobId, paper.baseId, { phase: '排版与导出' });
    const markdown = writeMarkdownPair(paperDir, { article, paper, figures, editor: request.editor, reviewer: request.reviewer });
    const htmlFile = writeHtml(markdown.localFile, path.join(paperDir, 'article.html'), article.displayTitle || paper.title);
    const pdfFile = path.join(paperDir, 'article.pdf');
    const pdf = await exportPdf(htmlFile, pdfFile, request.pdfMode, cfg, log);
    const markdownCharacters = fs.readFileSync(markdown.localFile, 'utf8').length;
    const manifest = {
      generatedAt: new Date().toISOString(),
      paper,
      venueVerification: paper.verifiedVenue,
      article,
      length: { profile: request.length, articleCharacters: article.generatedTextCharacters, markdownCharacters },
      figures: figures.map(({ file, ...item }) => ({ ...item, localFile: path.relative(paperDir, file).split(path.sep).join('/') })),
      pdf,
      files: {
        localMarkdown: 'article.local.md', mdniceMarkdown: 'article.mdnice.md', html: 'article.html',
        pdf: 'article.pdf', source: 'source.pdf', manifest: 'manifest.json'
      }
    };
    atomicJson(path.join(paperDir, 'manifest.json'), manifest);
    const files = Object.fromEntries(Object.entries(manifest.files).map(([key, value]) => [key, relativeOutput(path.join(paperDir, value))]));
    paperPatch(jobId, paper.baseId, {
      status: 'completed', phase: '完成', figures: figures.length, files,
      pdfMode: pdf.actualMode, markdownCharacters, articleCharacters: article.generatedTextCharacters
    });
    log(`[${paper.title}] 完成：Markdown ${markdownCharacters} 字符，正文 ${article.generatedTextCharacters} 字符`);
    return manifest;
  } catch (error) {
    paperPatch(jobId, paper.baseId, { status: 'failed', phase: '失败', error: error.message });
    log(`[${paper.title}] 失败：${error.message}`, 'error');
    throw error;
  }
}

export async function runJob(jobId, options = {}) {
  const cfg = readSettings();
  const job = getJob(jobId);
  if (!job) throw new Error(`任务不存在：${jobId}`);
  const request = validateRequest(job.request);
  const log = jobLogger(jobId, options.onEvent);
  const batchDir = path.join(OUTPUT_DIR, jobId);
  fs.mkdirSync(batchDir, { recursive: true });
  updateJob(jobId, { status: 'running', phase: '准备任务', progress: 2, request });
  try {
    if (!cfg.llmApiKey || !cfg.llmModel) throw new Error('请在 .env 中配置 LLM_API_KEY、LLM_BASE_URL 和 LLM_MODEL。');
    let candidates = normalizePaperInputs(request.paperUrls);
    if (request.topic) {
      updateJob(jobId, { phase: '搜索目标会议论文', progress: 5 });
      const searched = await searchPapers(request.topic, request.count, request.venues, request.tracks, request.years, cfg, log);
      candidates = uniqueCandidates([...candidates, ...searched]);
    }
    if (!candidates.length) throw new Error('没有找到可处理的 arXiv 论文。请调整主题、会议或年份。');

    updateJob(jobId, { phase: '整理会议与分类', progress: 11 });
    const candidateLimit = Math.max(request.count * 3, request.count);
    const candidatePool = candidates.slice(0, candidateLimit);
    log(`Tavily 汇总 ${candidates.length} 篇候选，读取前 ${candidatePool.length} 篇 arXiv 论文页面`);
    const enriched = await enrichArxiv(candidatePool, { onLog: log, delayMs: cfg.arxivMetadataDelayMs });
    const withImpact = await addImpactSignals(enriched, cfg, log);
    const verified = [];
    for (const paper of withImpact) {
      const check = verifyVenue(paper, request.venues, request.tracks, request.years);
      if (check.accepted) verified.push({ ...paper, verifiedVenue: check });
      else log(`排除 ${paper.title}：${check.reason}`, 'warn');
    }
    const papers = rankPapers(verified).slice(0, request.count);
    if (!papers.length) {
      throw new Error(`候选论文没有匹配到目标会议查询或元数据。范围：${request.venues.join('/')}，${request.tracks.join('/')}，${request.years.join(', ')}。`);
    }
    if (papers.length < request.count) log(`搜索得到 ${papers.length} 篇可处理论文，少于请求的 ${request.count} 篇。`, 'warn');

    updateJob(jobId, {
      papers: papers.map(paper => ({ ...paper, status: 'queued', phase: '等待处理' })),
      phase: `处理 ${papers.length} 篇论文`, progress: 18
    });
    let finished = 0;
    const results = await mapLimit(papers, cfg.maxParallelPapers, async paper => {
      const value = await processPaper(jobId, paper, request, cfg, batchDir, options.onEvent);
      finished += 1;
      updateJob(jobId, { progress: 18 + Math.round(80 * finished / papers.length) });
      return value;
    });
    const failed = results.filter(item => item.status === 'rejected').length;
    const completed = results.length - failed;
    atomicJson(path.join(batchDir, 'index.json'), { jobId, request, completed, failed, generatedAt: new Date().toISOString() });
    updateJob(jobId, {
      status: completed ? (failed ? 'partial' : 'completed') : 'failed',
      phase: completed ? (failed ? '部分完成' : '完成') : '全部失败',
      progress: 100, outputDir: batchDir, summary: { total: results.length, completed, failed }
    });
    return getJob(jobId);
  } catch (error) {
    log(error.message, 'error');
    updateJob(jobId, { status: 'failed', phase: '失败', progress: 100, error: error.message, outputDir: batchDir });
    throw error;
  }
}
