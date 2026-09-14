import fs from 'node:fs';
import { XMLParser } from 'fast-xml-parser';
import { fetchWithRetry } from '../utils.js';
import { extractArxivId } from './tavily.js';

const parser = new XMLParser({ ignoreAttributes: false, trimValues: true });

function asArray(value) {
  if (!value) return [];
  return Array.isArray(value) ? value : [value];
}

export function normalizePaperInputs(lines) {
  return String(lines || '')
    .split(/[\r\n,]+/)
    .map(value => value.trim())
    .filter(Boolean)
    .map((value, manualIndex) => {
      const id = extractArxivId(value);
      if (!id) throw new Error(`无法识别 arXiv 地址或 ID：${value}`);
      return { id, baseId: id.replace(/v\d+$/i, ''), url: `https://arxiv.org/abs/${id}`, appearances: 99, searchScore: 99, manualIndex };
    });
}

export async function enrichArxiv(candidates) {
  if (!candidates.length) return [];
  const ids = [...new Set(candidates.map(item => item.id))];
  const response = await fetchWithRetry(`https://export.arxiv.org/api/query?id_list=${encodeURIComponent(ids.join(','))}&max_results=${ids.length}`, {
    headers: { 'User-Agent': 'PaperFlowPublisher/1.0 (local research reader)' },
    timeoutMs: 60000
  });
  const feed = parser.parse(await response.text()).feed || {};
  const byBase = new Map();
  for (const entry of asArray(feed.entry)) {
    const id = extractArxivId(entry.id);
    if (!id) continue;
    const categories = asArray(entry.category).map(x => x?.['@_term']).filter(Boolean);
    const authors = asArray(entry.author).map(x => typeof x === 'string' ? x : x.name).filter(Boolean);
    const links = asArray(entry.link);
    const pdfLink = links.find(x => x?.['@_title'] === 'pdf')?.['@_href'] || `https://arxiv.org/pdf/${id}`;
    byBase.set(id.replace(/v\d+$/i, ''), {
      id,
      baseId: id.replace(/v\d+$/i, ''),
      title: String(entry.title || '').replace(/\s+/g, ' ').trim(),
      abstract: String(entry.summary || '').replace(/\s+/g, ' ').trim(),
      authors,
      categories,
      primaryCategory: entry['arxiv:primary_category']?.['@_term'] || categories[0] || '',
      published: entry.published || '',
      updated: entry.updated || '',
      comment: entry['arxiv:comment'] || '',
      journalRef: entry['arxiv:journal_ref'] || '',
      doi: entry['arxiv:doi'] || '',
      absUrl: `https://arxiv.org/abs/${id}`,
      pdfUrl: pdfLink
    });
  }
  return candidates.map(candidate => ({
    ...candidate,
    title: candidate.title || `arXiv ${candidate.id}`,
    abstract: candidate.abstract || '',
    authors: candidate.authors || [],
    categories: candidate.categories || [],
    published: candidate.published || '',
    updated: candidate.updated || '',
    absUrl: candidate.url || `https://arxiv.org/abs/${candidate.id}`,
    pdfUrl: `https://arxiv.org/pdf/${candidate.id}`,
    ...(byBase.get(candidate.baseId) || {})
  })).filter(item => item.title && item.pdfUrl);
}

export async function downloadPaper(paper, destination) {
  const response = await fetchWithRetry(paper.pdfUrl, {
    headers: { 'User-Agent': 'PaperFlowPublisher/1.0 (local research reader)' },
    timeoutMs: 120000
  });
  const contentType = response.headers.get('content-type') || '';
  const bytes = Buffer.from(await response.arrayBuffer());
  if (bytes.length < 1000 || (!contentType.includes('pdf') && bytes.subarray(0, 4).toString() !== '%PDF')) {
    throw new Error(`下载内容不是有效 PDF：${paper.pdfUrl}`);
  }
  fs.writeFileSync(destination, bytes);
  return destination;
}
