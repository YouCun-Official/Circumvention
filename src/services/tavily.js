import { fetchWithRetry } from '../utils.js';

export function extractArxivId(value) {
  const input = String(value || '').trim();
  const match = input.match(/(?:arxiv\.org\/(?:abs|pdf|html)\/)?((?:\d{4}\.\d{4,5}|[a-z-]+(?:\.[A-Z]{2})?\/\d{7})(?:v\d+)?)/i);
  return match ? match[1].replace(/\.pdf$/i, '') : null;
}

function queryTrackLabel(tracks) {
  const labels = { main: 'main conference', workshop: 'workshop', findings: 'findings' };
  return tracks.map(track => labels[track] || track).join(' OR ');
}

function inferTrack(result, tracks) {
  const text = `${result.title || ''} ${result.content || ''} ${result.url || ''}`;
  if (tracks.includes('findings') && /\bfindings\b/i.test(text)) return 'findings';
  if (tracks.includes('workshop') && /\bworkshops?\b/i.test(text)) return 'workshop';
  if (tracks.length === 1) return tracks[0];
  return 'main';
}

function inferYear(result, years) {
  const text = `${result.title || ''} ${result.content || ''} ${result.url || ''}`;
  const mentioned = years.filter(year => new RegExp(`\\b${year}\\b`).test(text));
  return mentioned[0] || years.at(-1);
}

export async function searchPapers(topic, count, venues, tracks, years, cfg, onLog = () => {}) {
  if (!cfg.tavilyApiKey) throw new Error('未配置 Tavily API Key。');
  const collected = new Map();
  const perVenue = Math.max(6, Math.ceil(count * 4 / Math.max(1, venues.length)));
  const venueDelayMs = Math.max(0, Number(cfg.tavilyVenueDelayMs ?? 15000));

  for (const [venueIndex, venue] of venues.entries()) {
    const query = `${topic} ${venue} (${years.join(' OR ')}) (${queryTrackLabel(tracks)}) research paper arXiv`;
    onLog(`Tavily 搜索：${venue}｜${topic}`);
    const response = await fetchWithRetry('https://api.tavily.com/search', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${cfg.tavilyApiKey}`
      },
      body: JSON.stringify({
        query,
        topic: 'general',
        search_depth: 'basic',
        max_results: perVenue,
        include_answer: false,
        include_raw_content: false,
        include_domains: ['arxiv.org']
      }),
      onRetry: ({ delayMs, error }) => onLog(`Tavily 请求失败，${Math.round(delayMs / 1000)} 秒后重试：${error.message}`, 'warn')
    });
    const data = await response.json();
    for (const [rank, result] of (data.results || []).entries()) {
      const id = extractArxivId(result.url) || extractArxivId(result.content);
      if (!id) continue;
      const baseId = id.replace(/v\d+$/i, '');
      const evidence = {
        venue,
        year: inferYear(result, years),
        track: inferTrack(result, tracks),
        query,
        resultUrl: result.url
      };
      const previous = collected.get(baseId) || {
        id,
        baseId,
        url: `https://arxiv.org/abs/${id}`,
        title: result.title || '',
        snippets: [],
        appearances: 0,
        searchScore: 0,
        venueHints: [],
        queryEvidence: []
      };
      previous.appearances += 1;
      previous.searchScore += Number(result.score || 0) + 1 / (rank + 1);
      if (result.content) previous.snippets.push(result.content);
      if (!previous.venueHints.includes(venue)) previous.venueHints.push(venue);
      if (!previous.queryEvidence.some(item => item.venue === evidence.venue && item.year === evidence.year && item.track === evidence.track)) {
        previous.queryEvidence.push(evidence);
      }
      collected.set(baseId, previous);
    }
    if (venueIndex < venues.length - 1 && venueDelayMs > 0) {
      onLog(`等待约 ${Math.round(venueDelayMs / 1000)} 秒，避免触发 Tavily 请求频率限制`);
      await new Promise(resolve => setTimeout(resolve, venueDelayMs));
    }
  }

  return [...collected.values()]
    .sort((a, b) => b.appearances - a.appearances || b.searchScore - a.searchScore)
    .slice(0, Math.max(count * 6, count));
}
