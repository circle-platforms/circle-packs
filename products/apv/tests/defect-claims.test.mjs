import { test } from 'node:test';
import assert from 'node:assert/strict';
import { extractDefectClaims } from '../tools/defect-claims.ts';

// Synthetic bug_detail item; field names and shapes follow the hub return, values are fake.
const full = {
  items: [{
    id: '1',
    state: 'closed',
    title: '示例缺陷标题',
    product: '9',
    priority: { code: '3', label: '正常' },
    severity: { code: '2', label: '严重' },
    resolution: { raw: 'fixed', mapped: null },
    openedBuild: 'trunk',
    resolvedBuild: 'trunk',
    legacyIssueId: '120419',
    actions: [
      { action: 'opened', date: '2026-01-01T00:00:00.000Z', actor: 'a', comment: '' },
      { action: 'svncommited', date: '2026-01-02T00:00:00.000Z', actor: 'b', comment: 'Fixed Details: 修复说明' },
    ],
  }],
};

test('a full item yields the field predicates, the svn fix note and the legacy id', () => {
  const claims = extractDefectClaims(full, 'knr_abc');
  const predicates = claims.map((c) => c.predicate).sort();
  assert.deepEqual(predicates, ['affects_product', 'affects_version', 'fixed_in_build', 'legacy_issue_id', 'priority', 'repair_note', 'resolution', 'severity', 'status', 'title']);
  for (const claim of claims) {
    assert.equal(claim.subject, 'defect:1');
    assert.equal(claim.origin, 'script');
    assert.deepEqual(claim.evidenceIds, ['knr_abc']);
  }
  const note = claims.find((c) => c.predicate === 'repair_note');
  assert.equal(note.value.actor, 'b');
  assert.match(note.value.comment, /Fixed Details/);
  assert.equal(claims.find((c) => c.predicate === 'legacy_issue_id').value, '120419');
});

test('missing fields yield no claims and nothing is invented', () => {
  const sparse = { items: [{ id: '2', state: 'active', title: 't', legacyIssueId: '0', actions: [] }] };
  const claims = extractDefectClaims(sparse, 'knr_x');
  const predicates = claims.map((c) => c.predicate);
  assert.deepEqual(predicates.sort(), ['status', 'title']);
  assert.ok(!predicates.includes('legacy_issue_id'), '"0" means none, not a claim');
  assert.ok(!predicates.includes('repair_note'), 'no svn commit, no note');
});

test('an empty or malformed result is refused, not guessed around', () => {
  assert.throws(() => extractDefectClaims({ items: 'nope' }, 'knr_x'), /items/);
  assert.throws(() => extractDefectClaims(full, ''), /evidenceId/);
});

test('items without an id are skipped; evidenceId may be null for local dry runs', () => {
  const claims = extractDefectClaims({ items: [{ title: 'no id' }, { id: '3', state: 'active' }] }, null);
  assert.deepEqual(claims.map((c) => c.subject), ['defect:3']);
  assert.deepEqual(claims[0].evidenceIds, []);
});
