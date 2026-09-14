import test from 'node:test';
import assert from 'node:assert/strict';
import { parseTracks, parseVenues, parseYears, verifyVenue } from '../src/services/venues.js';

test('venue, track and year parameters are normalized', () => {
  assert.deepEqual(parseVenues('icml, ACL,icml'), ['ICML', 'ACL']);
  assert.deepEqual(parseTracks('main,Findings'), ['main', 'findings']);
  assert.deepEqual(parseYears('2026,2025,2026'), [2025, 2026]);
  assert.throws(() => parseVenues('CVPR'), /不支持/);
});

test('main, workshop and findings papers are identified from metadata', () => {
  const main = verifyVenue({ comment: 'Accepted at ICLR 2026' }, ['ICLR'], ['main'], [2026]);
  assert.equal(main.label, 'ICLR 2026');

  const workshop = verifyVenue({ comment: 'NeurIPS 2025 Workshop on Foundation Models' }, ['NEURIPS'], ['workshop'], [2025]);
  assert.equal(workshop.track, 'workshop');

  const findings = verifyVenue({ journalRef: 'Findings of ACL 2025' }, ['ACL'], ['findings'], [2025]);
  assert.equal(findings.track, 'findings');
});

test('Tavily venue-scoped query evidence is accepted', () => {
  const result = verifyVenue({
    queryEvidence: [{ venue: 'KDD', year: 2026, track: 'workshop', query: 'graph agents KDD 2026 workshop research paper arXiv' }]
  }, ['KDD'], ['workshop'], [2026]);
  assert.equal(result.accepted, true);
  assert.equal(result.label, 'KDD 2026 Workshop');
});

test('unverified, disallowed venue, track, or year is rejected', () => {
  assert.equal(verifyVenue({ comment: 'Submitted manuscript' }, ['ICML'], ['main'], [2026]).accepted, false);
  assert.equal(verifyVenue({ comment: 'CVPR 2026' }, ['ICML'], ['main'], [2026]).accepted, false);
  assert.equal(verifyVenue({ comment: 'ICML 2026 Workshop' }, ['ICML'], ['main'], [2026]).accepted, false);
  assert.equal(verifyVenue({ comment: 'ICML 2024' }, ['ICML'], ['main'], [2026]).accepted, false);
});
