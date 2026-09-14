import { extractJson, fetchWithRetry, normalizeBaseUrl } from '../utils.js';

function endpoint(baseUrl) {
  const base = normalizeBaseUrl(baseUrl);
  return /\/chat\/completions$/i.test(base) ? base : `${base}/chat/completions`;
}

export async function chat(cfg, { messages, model, temperature = 0.2, maxTokens = 8000, json = false }) {
  if (!cfg.llmApiKey || !cfg.llmModel) throw new Error('未配置模型 API Key 或模型名。');
  const body = {
    model: model || cfg.llmModel,
    messages,
    temperature,
    max_tokens: maxTokens
  };
  if (json) body.response_format = { type: 'json_object' };
  let response;
  try {
    response = await fetchWithRetry(endpoint(cfg.llmBaseUrl), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${cfg.llmApiKey}` },
      body: JSON.stringify(body),
      timeoutMs: 180000
    }, 2);
  } catch (error) {
    if (json && /response_format|json_object/i.test(error.message)) {
      delete body.response_format;
      response = await fetchWithRetry(endpoint(cfg.llmBaseUrl), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${cfg.llmApiKey}` },
        body: JSON.stringify(body),
        timeoutMs: 180000
      }, 2);
    } else throw error;
  }
  const data = await response.json();
  const content = data.choices?.[0]?.message?.content;
  if (!content) throw new Error(`模型没有返回正文：${JSON.stringify(data).slice(0, 600)}`);
  return content;
}

export async function visionJson(cfg, prompt, imageBuffer) {
  const content = await chat(cfg, {
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
  compact: { min: 2100, max: 2900, target: 2500, label: '短篇' },
  standard: { min: 3000, max: 4400, target: 3700, label: '标准篇幅' },
  detailed: { min: 4700, max: 6200, target: 5400, label: '长篇' }
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

export async function writeArticle(cfg, paper, sourceText, figures, lengthName = 'standard', onLog = () => {}) {
  const profile = LENGTH_PROFILES[lengthName] || LENGTH_PROFILES.standard;
  const figureList = figures.map(item => ({ id: item.id, originalCaption: item.caption, page: item.page }));
  const prompt = `你是一名严谨的中文科研编辑。根据提供的论文元数据、原文摘录和图片清单，撰写适合微信公众号的论文解读。

规则：
1. 只能使用给定材料中的事实、指标和结论；不确定的内容省略，禁止猜测会议录用状态和实验数字。
2. 语言自然、清楚、有信息密度，避免夸张宣传和空洞评价。
3. 背景应说明问题和已有方法局限；方法部分讲清组件和流程；实验部分包含最有代表性的定量结果；结论概括价值与边界。
4. 每个图片 ID 最多使用一次，只把图放到确实相关的章节；可不使用质量或相关性不足的图片。
5. 输出严格 JSON，不要 Markdown 围栏。结构如下：
{
  "displayTitle": "简短的论文分享标题",
  "venue": "材料中明确出现的会议/期刊/arXiv年份，否则写 arXiv",
  "sections": [
    {
      "heading": "研究背景",
      "paragraphs": ["完整段落"],
      "points": [{"title": "要点标题", "body": "完整说明"}],
      "figureIds": ["fig-01"]
    }
  ],
  "figureCaptions": {"fig-01": "与正文一致的简明中文图注"},
  "conclusion": ["完整结论段落"]
}
必须包含研究背景、技术架构或方法、模型表现三个章节。根据论文内容可以增加数据集、消融实验等章节。正文目标长度为 ${profile.min}-${profile.max} 个中文字符，尽量接近 ${profile.target} 字符。

论文元数据：
${JSON.stringify({ title: paper.title, authors: paper.authors, abstract: paper.abstract, published: paper.published, updated: paper.updated, comment: paper.comment, journalRef: paper.journalRef, verifiedVenue: paper.verifiedVenue, url: paper.absUrl }, null, 2)}

图片清单：
${JSON.stringify(figureList, null, 2)}

原文摘录：
${sourceText.slice(0, 65000)}`;
  const content = await chat(cfg, {
    json: true,
    temperature: 0.25,
    maxTokens: lengthName === 'detailed' ? 14000 : lengthName === 'compact' ? 7500 : 10500,
    messages: [
      { role: 'system', content: '你只输出符合要求的 JSON。保留原始英文专有名词，准确转写数字。' },
      { role: 'user', content: prompt }
    ]
  });
  let article = validateArticle(extractJson(content));
  let size = articleTextLength(article);
  for (let revisionNo = 1; revisionNo <= 2 && (size < profile.min || size > profile.max); revisionNo += 1) {
    onLog(`${revisionNo === 1 ? '初稿' : '修订稿'}正文约 ${size} 字符，正在调整到 ${profile.min}-${profile.max} 字符`);
    const revision = await chat(cfg, {
      json: true,
      temperature: 0.15,
      maxTokens: lengthName === 'detailed' ? 14500 : 11000,
      messages: [
        { role: 'system', content: '你是中文科技文章编辑，只输出严格 JSON。' },
        { role: 'user', content: `将下面的论文解读改写到 ${profile.min}-${profile.max} 个中文字符，目标约 ${profile.target} 字符。保持 JSON 字段结构、事实、数字和图片 ID 不变；过短时补充原文已有的方法机制与实验分析，过长时删除重复表述。禁止引入原材料没有的信息。\n\n当前稿件：\n${JSON.stringify(article)}\n\n可核对的原文摘录：\n${sourceText.slice(0, 45000)}` }
      ]
    });
    article = validateArticle(extractJson(revision));
    size = articleTextLength(article);
  }
  if (size < profile.min * 0.9 || size > profile.max * 1.1) {
    throw new Error(`模型两次修订后正文仍为 ${size} 字符，未达到 ${profile.min}-${profile.max} 的篇幅要求。`);
  }
  if (size < profile.min || size > profile.max) onLog(`最终正文 ${size} 字符，轻微超出目标区间。`, 'warn');
  article.generatedTextCharacters = size;
  article.requestedLength = { name: lengthName, ...profile };
  return article;
}
