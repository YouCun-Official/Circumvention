import fs from 'node:fs';
import { fetchWithRetry } from '../utils.js';
import { extractArxivId } from './tavily.js';

function decodeHtml(value) {
  return String(value || '')
    .replace(/&#(\d+);/g, (_, code) => String.fromCodePoint(Number(code)))
    .replace(/&#x([\da-f]+);/gi, (_, code) => String.fromCodePoint(Number.parseInt(code, 16)))
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&quot;/gi, '"')
    .replace(/&apos;|&#39;/gi, "'")
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>');
}

function cleanText(value) {
  return decodeHtml(String(value || '').replace(/<[^>]+>/g, ' ')).replace(/\s+/g, ' ').trim();
}

function tagAttribute(tag, name) {
  const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const match = tag.match(new RegExp(`\\b${escaped}\\s*=\\s*(["'])([\\s\\S]*?)\\1`, 'i'));
  return match ? decodeHtml(match[2]).trim() : '';
}

function metaValues(html, name) {
  return [...String(html || '').matchAll(/<meta\b[^>]*>/gi)]
    .filter(match => tagAttribute(match[0], 'name').toLowerCase() === name.toLowerCase())
    .map(match => tagAttribute(match[0], 'content'))
    .filter(Boolean);
}

function tableValue(html, className) {
  const escaped = className.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const match = String(html || '').match(new RegExp(`<td[^>]*class=["'][^"']*\\b${escaped}\\b[^"']*["'][^>]*>([\\s\\S]*?)<\\/td>`, 'i'));
  return cleanText(match?.[1]);
}

export function parseArxivAbs(html, fallbackId) {
  const id = metaValues(html, 'citation_arxiv_id')[0] || fallbackId;
  const categories = metaValues(html, 'citation_keywords')
    .flatMap(value => value.split(/[;,]/))
    .map(value => value.trim())
    .filter(Boolean);
  const pdfUrl = (metaValues(html, 'citation_pdf_url')[0] || `https://arxiv.org/pdf/${id}`).replace(/^http:/i, 'https:');
  const date = metaValues(html, 'citation_date')[0] || '';
  return {
    id,
    baseId: String(id).replace(/v\d+$/i, ''),
    title: cleanText(metaValues(html, 'citation_title')[0]),
    abstract: cleanText(metaValues(html, 'citation_abstract')[0]),
    authors: metaValues(html, 'citation_author').map(cleanText),
    categories,
    primaryCategory: categories[0] || '',
    published: date ? date.replaceAll('/', '-') : '',
    updated: '',
    comment: tableValue(html, 'comments'),
    journalRef: tableValue(html, 'jref'),
    doi: metaValues(html, 'citation_doi')[0] || '',
    absUrl: `https://arxiv.org/abs/${id}`,
    pdfUrl
  };
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

function fallbackMetadata(candidate) {
  return {
    ...candidate,
    title: candidate.title || `arXiv ${candidate.id}`,
    abstract: candidate.abstract || (candidate.snippets || []).join(' '),
    authors: candidate.authors || [],
    categories: candidate.categories || [],
    published: candidate.published || '',
    updated: candidate.updated || '',
    comment: candidate.comment || '',
    journalRef: candidate.journalRef || '',
    absUrl: candidate.url || `https://arxiv.org/abs/${candidate.id}`,
    pdfUrl: candidate.pdfUrl || `https://arxiv.org/pdf/${candidate.id}`
  };
}

export async function enrichArxiv(candidates, { onLog = () => {}, delayMs = 1000 } = {}) {
  const enriched = [];
  for (const [index, candidate] of candidates.entries()) {
    const base = fallbackMetadata(candidate);
    onLog(`读取 arXiv 论文页面 (${index + 1}/${candidates.length})：${candidate.id}`);
    try {
      const response = await fetchWithRetry(`https://arxiv.org/abs/${candidate.id}`, {
        headers: { 'User-Agent': 'Mozilla/5.0 PaperFlowPublisher/1.0 (local research reader)' },
        timeoutMs: 45000
      }, 1);
      const metadata = parseArxivAbs(await response.text(), candidate.id);
      enriched.push({
        ...base,
        ...metadata,
        title: metadata.title || base.title,
        abstract: metadata.abstract || base.abstract,
        authors: metadata.authors.length ? metadata.authors : base.authors,
        categories: metadata.categories.length ? metadata.categories : base.categories
      });
    } catch (error) {
      onLog(`arXiv 页面读取失败，使用 Tavily 元数据继续：${candidate.id}（${error.message}）`, 'warn');
      enriched.push(base);
    }
    if (index < candidates.length - 1 && delayMs > 0) {
      await new Promise(resolve => setTimeout(resolve, delayMs));
    }
  }
  return enriched.filter(item => item.title && item.pdfUrl);
}

export async function downloadPaper(paper, destination) {
  const response = await fetchWithRetry(paper.pdfUrl, {
    headers: { 'User-Agent': 'Mozilla/5.0 PaperFlowPublisher/1.0 (local research reader)' },
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
