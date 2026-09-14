import { fetchWithRetry } from '../utils.js';

function monthsOld(date) {
  const timestamp = Date.parse(date || '');
  if (!Number.isFinite(timestamp)) return 12;
  return Math.max(1, (Date.now() - timestamp) / (30.44 * 24 * 3600 * 1000));
}

export async function addImpactSignals(papers, cfg = {}, onLog = () => {}) {
  if (!papers.length) return papers;
  try {
    onLog('读取 Semantic Scholar 引用与影响力数据');
    const response = await fetchWithRetry(
      'https://api.semanticscholar.org/graph/v1/paper/batch?fields=title,venue,citationCount,influentialCitationCount,publicationDate',
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'User-Agent': 'PaperFlowPublisher/1.0',
          ...(cfg.semanticScholarApiKey ? { 'x-api-key': cfg.semanticScholarApiKey } : {})
        },
        body: JSON.stringify({ ids: papers.map(paper => `ARXIV:${paper.baseId}`) }),
        timeoutMs: 45000
      },
      1
    );
    const records = await response.json();
    return papers.map((paper, index) => {
      const impact = records[index] || {};
      const citationCount = Number(impact.citationCount || 0);
      const influentialCitationCount = Number(impact.influentialCitationCount || 0);
      const ageMonths = monthsOld(impact.publicationDate || paper.published);
      const citationVelocity = citationCount / ageMonths;
      const hotScore = Number(paper.searchScore || 0) +
        Math.log1p(citationCount) * 0.55 +
        Math.log1p(influentialCitationCount) * 0.8 +
        Math.log1p(citationVelocity) * 1.25;
      return {
        ...paper,
        impact: { venue: impact.venue || '', citationCount, influentialCitationCount, citationVelocity: Number(citationVelocity.toFixed(3)), source: 'Semantic Scholar' },
        hotScore: Number(hotScore.toFixed(4))
      };
    });
  } catch (error) {
    onLog(`影响力数据暂不可用，按 Tavily 搜索热度排序：${error.message}`, 'warn');
    return papers.map(paper => ({ ...paper, hotScore: Number(paper.searchScore || 0), impact: null }));
  }
}

export function rankPapers(papers) {
  return [...papers].sort((a, b) => {
    if (a.manualIndex != null || b.manualIndex != null) {
      if (a.manualIndex != null && b.manualIndex != null) return a.manualIndex - b.manualIndex;
      return a.manualIndex != null ? -1 : 1;
    }
    return (b.hotScore || 0) - (a.hotScore || 0) || String(b.published || '').localeCompare(String(a.published || ''));
  });
}
