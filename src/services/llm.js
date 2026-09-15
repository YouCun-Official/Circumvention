import fs from 'node:fs';
import { createHash } from 'node:crypto';
import { atomicJson, extractJson, fetchWithRetry, normalizeBaseUrl } from '../utils.js';

function endpoint(baseUrl) {
  const base = normalizeBaseUrl(baseUrl);
  return /\/chat\/completions$/i.test(base) ? base : `${base}/chat/completions`;
}

function contentText(value) {
  if (typeof value === 'string') return value;
  if (Array.isArray(value)) return value.map(item => typeof item === 'string' ? item : item?.text || '').join('');
  return '';
}

export function parseModelResponse(text, contentType = '') {
  const raw = String(text || '');
  if (/text\/event-stream/i.test(contentType) || /^data:\s/m.test(raw)) {
    let content = '';
    for (const line of raw.split(/\r?\n/)) {
      if (!line.startsWith('data:')) continue;
      const payload = line.slice(5).trim();
      if (!payload || payload === '[DONE]') continue;
      let event;
      try { event = JSON.parse(payload); } catch { continue; }
      if (event.error) throw new Error(`模型上游错误：${event.error.message || JSON.stringify(event.error)}`);
      const choice = event.choices?.[0];
      content += contentText(choice?.delta?.content ?? choice?.message?.content);
    }
    if (!content) throw new Error('模型流式响应没有正文。');
    return content;
  }
  let data;
  try { data = JSON.parse(raw); }
  catch { throw new Error(`模型接口返回了非 JSON 内容（${contentType || '未知类型'}）：${raw.slice(0, 120).replace(/\s+/g, ' ')}`); }
  if (data.error) throw new Error(`模型上游错误：${data.error.message || JSON.stringify(data.error)}`);
  const content = contentText(data.choices?.[0]?.message?.content);
  if (!content) throw new Error(`模型没有返回正文：${JSON.stringify(data).slice(0, 600)}`);
  return content;
}

async function requestChat(cfg, body, onRetry) {
  const response = await fetchWithRetry(endpoint(cfg.llmBaseUrl), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${cfg.llmApiKey}` },
    body: JSON.stringify(body),
    timeoutMs: 180000,
    onRetry
  }, 1);
  const text = await response.text();
  return parseModelResponse(text, response.headers.get('content-type') || '');
}

export async function chat(cfg, { messages, model, temperature = 0.2, maxTokens = 8000, json = false, attempts = 4, onRetry = () => {} }) {
  if (!cfg.llmApiKey || !cfg.llmModel) throw new Error('未配置模型 API Key 或模型名。');
  const body = {
    model: model || cfg.llmModel,
    messages,
    temperature,
    max_tokens: maxTokens,
    stream: true
  };
  if (json) body.response_format = { type: 'json_object' };
  let last;
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    try {
      return await requestChat(cfg, body, ({ delayMs, error }) => onRetry(`模型请求失败，${Math.round(delayMs / 1000)} 秒后重试：${error.message}`));
    } catch (error) {
      last = error;
      if (json && /response_format|json_object/i.test(error.message)) delete body.response_format;
      if (attempt >= attempts - 1) break;
      const delayMs = 5000 * (attempt + 1);
      onRetry(`模型接口第 ${attempt + 1} 次请求失败，${Math.round(delayMs / 1000)} 秒后重试：${error.message}`);
      await new Promise(resolve => setTimeout(resolve, delayMs));
    }
  }
  throw last;
}

export async function visionJson(cfg, prompt, imageBuffer) {
  const content = await chat(cfg, {
    attempts: 1,
    model: cfg.visionModel || cfg.llmModel,
    json: true,
    temperature: 0,
    maxTokens: 2000,
    messages: [{
      role: 'user',
      content: [
        { type: 'text', text: prompt },
        { type: 'image_url', image_url: { url: `data:image/png;base64,${imageBuffer.toString('base64')}`, detail: 'high' } }
      ]
    }]
  });
  return extractJson(content);
}

export const LENGTH_PROFILES = {
  compact: { min: 1400, max: 1800, target: 1600, label: '短篇' },
  standard: { min: 1850, max: 2150, target: 2000, label: '标准篇幅' },
  detailed: { min: 3000, max: 4000, target: 3500, label: '长篇' }
};

export function articleTextLength(article) {
  const parts = [];
  for (const section of article.sections || []) {
    parts.push(section.heading || '', ...(section.paragraphs || []));
    for (const point of section.points || []) parts.push(point.title || '', point.body || '');
    for (const item of section.numberedItems || []) parts.push(item.title || '', item.body || '');
  }
  parts.push(...(article.conclusion || []));
  return parts.join('').replace(/\s+/g, '').length;
}

function validateArticle(article) {
  if (!Array.isArray(article.sections) || article.sections.length < 3) throw new Error('模型返回的文章结构不完整。');
  return article;
}

// Serialize writing requests across papers to reduce gateway pressure.
let writingQueue = Promise.resolve();
function serialChat(cfg, args) {
  const task = writingQueue.then(() => chat(cfg, args));
  writingQueue = task.catch(() => {});
  return task;
}

function sourceForSection(source, index) {
  const chunks = source.split(/\n--- PAGE \d+ ---\n/).filter(Boolean);
  const patterns = [
    /abstract|introduction|motivation/i,
    /method|framework|architecture|algorithm/i,
    /experiment|results|benchmark|evaluation/i,
    /ablation|limitation|discussion|conclusion/i
  ];
  const ranked = chunks.map((chunk, order) => ({
    chunk, order, score: (chunk.match(new RegExp(patterns[index].source, 'gi')) || []).length
  })).sort((a, b) => b.score - a.score || a.order - b.order);
  return ranked.slice(0, 3).sort((a, b) => a.order - b.order)
    .map(item => item.chunk.slice(0, 2700)).join('\n').slice(0, 8000);
}

export async function writeArticle(cfg, paper, sourceText, figures, lengthName = 'standard', onLog = () => {}, options = {}) {
  const profile = LENGTH_PROFILES[lengthName] || LENGTH_PROFILES.standard;
  const checkpointFile = options.checkpointFile;
  const signature = createHash('sha256').update(JSON.stringify({ sourceText, lengthName, profile, model: cfg.llmModel, version: 3 })).digest('hex');
  let state = { signature, article: { displayTitle: paper.title, venue: paper.verifiedVenue?.label || 'arXiv', sections: [], conclusion: [], figureCaptions: {} } };
  if (checkpointFile && fs.existsSync(checkpointFile)) {
    const saved = JSON.parse(fs.readFileSync(checkpointFile, 'utf8'));
    if (saved.signature === signature) { state = saved; onLog('已恢复章节草稿，继续处理未完成部分'); }
  }
  const save = () => { if (checkpointFile) atomicJson(checkpointFile, state); };
  const headings = ['研究背景', '技术架构与方法', '实验表现', '分析与总结'];
  const weights = [0.23, 0.30, 0.29, 0.18];
  const system = '你是中文科研编辑，只输出 JSON。严禁使用“不是……而是……”这种八股句式。所有数字与结论须有材料依据，禁止编造。字数按所有非空白字符计算，英文每个字母也计一个字符。';
  for (let index = 0; index < headings.length; index++) {
    const target = Math.round(profile.target * weights[index]);
    const lower = Math.round(profile.min * weights[index]);
    const upper = Math.floor(profile.max * weights[index]);
    let section = state.article.sections[index];
    const measure = value => articleTextLength({ sections: [value] });
    const distance = n => n < lower ? lower - n : Math.max(0, n - upper);
    if (!section) {
      onLog(`生成章节 ${index + 1}/4：${headings[index]}，目标约 ${target} 字符`);
      const response = await serialChat(cfg, {
        json: true, maxTokens: Math.max(2200, target * 3), temperature: 0.2,
        onRetry: message => onLog(message, 'warn'),
        messages: [
          { role: 'system', content: system },
          { role: 'user', content: `为论文《${paper.title}》撰写“${headings[index]}”章节，目标 ${target} 字符，范围 ${lower}-${upper}。仅写本章，避免重复前文。使用自然段，不要罗列英文名称。输出 {"paragraphs":["完整段落", "..."]}。\n已有章节：${state.article.sections.map(x => x.heading).join('、')}\n原文材料：\n${sourceForSection(sourceText, index)}` }
        ]
      });
      const data = extractJson(response);
      if (!Array.isArray(data.paragraphs) || !data.paragraphs.length || data.paragraphs.some(p => typeof p !== 'string')) throw new Error('章节响应缺少有效 paragraphs');
      section = { heading: headings[index], paragraphs: data.paragraphs, figureIds: [] };
      state.article.sections[index] = section;
      save();
    }
    for (let revision = 0; revision < 3 && distance(measure(section)) > 0; revision++) {
      const count = measure(section);
      const compress = count > upper;
      onLog(`修订“${headings[index]}”：${count} → 约 ${target} 字符（${compress ? '仅发送当前章节' : '附带本章原文'}）`);
      const response = await serialChat(cfg, {
        json: true, maxTokens: Math.max(2200, target * 3), temperature: 0.1,
        onRetry: message => onLog(message, 'warn'),
        messages: [
          { role: 'system', content: system },
          { role: 'user', content: `${compress ? '压缩' : '扩充'}以下章节到 ${lower}-${upper} 非空白字符，目标 ${target}，当前实测 ${count}。英文按字母计数。只输出 {"paragraphs":["完整段落"]}。保留关键机制、限定条件和核心实验数字。${compress ? '只删减和重述已有内容，禁止添加新事实。' : '只能依据所附原文补充。'}\n当前章节：${JSON.stringify(section)}${compress ? '' : '\n原文：' + sourceForSection(sourceText, index)}` }
        ]
      });
      const data = extractJson(response);
      if (!Array.isArray(data.paragraphs) || !data.paragraphs.length || data.paragraphs.some(p => typeof p !== 'string')) throw new Error('修订响应缺少有效 paragraphs');
      const candidate = { ...section, paragraphs: data.paragraphs };
      if (distance(measure(candidate)) < distance(measure(section))) {
        section = candidate;
        state.article.sections[index] = section;
        save();
      }
    }
  }
  const article = state.article;
  const size = articleTextLength(article);
  if (size < profile.min || size > profile.max) {
    save();
    throw new Error(`草稿已保存，正文 ${size} 字符，目标 ${profile.min}-${profile.max}；重新运行可继续章节修订。`);
  }
  // Keep every supplied figure and its source caption; distribute figures over relevant sections.
  article.sections.forEach(section => { section.figureIds = []; });
  figures.forEach((figure, index) => {
    article.sections[Math.min(index + 1, article.sections.length - 1)].figureIds.push(figure.id);
    article.figureCaptions[figure.id] = figure.caption;
  });
  article.generatedTextCharacters = size;
  article.lengthStatus = 'within_target';
  article.requestedLength = { name: lengthName, ...profile };
  save();
  return article;
}
