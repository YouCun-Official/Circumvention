import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

export function slugify(value, fallback = 'paper') {
  const clean = String(value || '')
    .normalize('NFKC')
    .replace(/[<>:"/\\|?*\x00-\x1F]/g, '-')
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^[.\s-]+|[.\s-]+$/g, '')
    .slice(0, 90);
  return clean || fallback;
}

export function jobId() {
  const stamp = new Date().toISOString().replace(/[-:TZ.]/g, '').slice(0, 14);
  return `${stamp}-${crypto.randomBytes(3).toString('hex')}`;
}

export function atomicJson(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const temp = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(temp, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
  fs.renameSync(temp, file);
}

export async function fetchWithRetry(url, options = {}, retries = 3) {
  let last;
  for (let attempt = 0; attempt < retries; attempt += 1) {
    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), options.timeoutMs || 60000);
      const response = await fetch(url, { ...options, signal: controller.signal });
      clearTimeout(timeout);
      if (response.ok) return response;
      const body = await response.text();
      last = new Error(`HTTP ${response.status} ${response.statusText}: ${body.slice(0, 500)}`);
      if (response.status < 500 && response.status !== 429) throw last;
    } catch (error) {
      last = error;
    }
    if (attempt < retries - 1) await new Promise(resolve => setTimeout(resolve, 700 * 2 ** attempt));
  }
  throw last;
}

export function extractJson(text) {
  const raw = String(text || '').trim();
  const fenced = raw.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const candidate = fenced ? fenced[1].trim() : raw;
  try { return JSON.parse(candidate); } catch {}
  const start = Math.min(...['{', '['].map(ch => {
    const index = candidate.indexOf(ch);
    return index < 0 ? Number.POSITIVE_INFINITY : index;
  }));
  if (!Number.isFinite(start)) throw new Error('模型响应中没有 JSON。');
  for (let end = candidate.length; end > start; end -= 1) {
    const tail = candidate[end - 1];
    if (tail !== '}' && tail !== ']') continue;
    try { return JSON.parse(candidate.slice(start, end)); } catch {}
  }
  throw new Error('无法解析模型返回的 JSON。');
}

export function normalizeBaseUrl(baseUrl) {
  return String(baseUrl || '').replace(/\/+$/, '');
}

export function escapeHtml(value) {
  return String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;');
}

export async function mapLimit(items, limit, worker) {
  const results = new Array(items.length);
  let cursor = 0;
  async function next() {
    while (cursor < items.length) {
      const index = cursor++;
      try {
        results[index] = { status: 'fulfilled', value: await worker(items[index], index) };
      } catch (reason) {
        results[index] = { status: 'rejected', reason };
      }
    }
  }
  await Promise.all(Array.from({ length: Math.min(Math.max(1, limit), items.length) }, next));
  return results;
}

export function posixRelative(from, to) {
  return path.relative(from, to).split(path.sep).join('/');
}
