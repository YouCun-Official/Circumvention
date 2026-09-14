export const VENUES = {
  ICML: /\bICML\b|International Conference on Machine Learning/i,
  ICLR: /\bICLR\b|International Conference on Learning Representations/i,
  AAAI: /\bAAAI\b|AAAI Conference on Artificial Intelligence/i,
  NEURIPS: /\bNeurIPS\b|\bNIPS\b|Neural Information Processing Systems/i,
  KDD: /\b(?:SIG)?KDD\b|Knowledge Discovery and Data Mining/i,
  ACL: /\bACL\b|Annual Meeting of the Association for Computational Linguistics/i,
  WWW: /\bWWW\s*['’]?(?:20)?\d{2}\b|The ?WebConf(?:erence)?|ACM Web Conference|World Wide Web Conference/i
};

export const TRACKS = new Set(['main', 'workshop', 'findings']);

export function parseList(value, allowed, fallback) {
  if (!value || String(value).toLowerCase() === 'all') return [...fallback];
  const items = String(value).split(',').map(x => x.trim().toUpperCase()).filter(Boolean);
  const normalized = [...new Set(items)];
  const invalid = normalized.filter(item => !allowed.has(item));
  if (invalid.length) throw new Error(`不支持的值：${invalid.join(', ')}`);
  return normalized;
}

export function parseVenues(value) {
  return parseList(value, new Set(Object.keys(VENUES)), Object.keys(VENUES));
}

export function parseTracks(value) {
  return parseList(value, new Set([...TRACKS].map(x => x.toUpperCase())), [...TRACKS].map(x => x.toUpperCase())).map(x => x.toLowerCase());
}

export function parseYears(value) {
  if (!value) {
    const year = new Date().getFullYear();
    return [year - 1, year];
  }
  const years = [...new Set(String(value).split(',').map(x => Number(x.trim())).filter(Number.isInteger))];
  if (!years.length || years.some(year => year < 2000 || year > new Date().getFullYear() + 2)) {
    throw new Error('年份格式错误。示例：--years 2025,2026');
  }
  return years.sort();
}

function verificationSources(paper) {
  return [
    ...((paper.queryEvidence || []).map(item => ['Tavily conference query', `${item.venue} ${item.year} ${item.track || 'main'}`])),
    ['arXiv journal reference', paper.journalRef],
    ['arXiv comment', paper.comment],
    ['Semantic Scholar venue', paper.impact?.venue],
    ...(paper.snippets || []).map(value => ['Tavily result excerpt', value])
  ].filter(([, value]) => Boolean(value));
}

function inferTrack(evidence) {
  if (/\bfindings\b/i.test(evidence)) return 'findings';
  if (/\bworkshop\b|\bworkshops\b/i.test(evidence)) return 'workshop';
  return 'main';
}

function inferYear(evidence, paper, venuePattern) {
  const venueMatch = evidence.match(venuePattern);
  const anchor = venueMatch ? venueMatch.index + venueMatch[0].length / 2 : 0;
  const years = [...evidence.matchAll(/\b(20\d{2})\b/g)]
    .map(match => ({ year: Number(match[1]), distance: Math.abs(match.index - anchor) }))
    .sort((a, b) => a.distance - b.distance);
  if (years.length) return years[0].year;
  const published = Number(String(paper.published || '').slice(0, 4));
  return Number.isInteger(published) ? published : null;
}

export function verifyVenue(paper, allowedVenues, allowedTracks, allowedYears) {
  let found = null;
  for (const [source, evidence] of verificationSources(paper)) {
    const venue = allowedVenues.find(name => VENUES[name].test(evidence));
    if (venue) { found = { venue, source, evidence }; break; }
  }
  if (!found) return { accepted: false, reason: 'Tavily 查询或论文元数据中没有目标会议信息' };
  const { venue, source, evidence } = found;
  const track = inferTrack(evidence);
  if (!allowedTracks.includes(track)) return { accepted: false, reason: `${venue} ${track} 不在允许分类中` };
  const year = inferYear(evidence, paper, VENUES[venue]);
  if (allowedYears.length && (!year || !allowedYears.includes(year))) {
    return { accepted: false, reason: `${venue} 年份 ${year || '未知'} 不在 ${allowedYears.join(', ')} 中` };
  }
  return {
    accepted: true,
    venue,
    track,
    year,
    label: `${venue} ${year}${track === 'main' ? '' : ` ${track === 'workshop' ? 'Workshop' : 'Findings'}`}`,
    evidenceSource: source,
    evidence: evidence.slice(0, 1200)
  };
}
