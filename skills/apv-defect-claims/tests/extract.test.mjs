import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { extractDefectClaims, extract, loadDetail } from '../scripts/extract.mjs';

// Synthetic bug_detail returns; field names and shapes follow the hub return, values are fake.
const detailReturn = (item, evidenceId = 'knr_1') => ({
  tool: 'zentao.bug_detail',
  args: { ids: [item.id] },
  at: '2026-10-13T00:00:00.000Z',
  response: { result: { items: [item] }, evidence: [{ evidenceId, sha256: 'ab'.repeat(32) }] },
});

const fullItem = {
  id: '7',
  state: 'closed',
  title: '示例缺陷',
  product: '9',
  priority: { code: '3', label: '正常' },
  severity: { code: '2', label: '严重' },
  resolution: { raw: 'fixed', mapped: null },
  openedBuild: 'trunk',
  resolvedBuild: 'trunk',
  legacyIssueId: '120419',
  actions: [{ action: 'svncommited', date: '2026-01-02T00:00:00.000Z', actor: 'b', comment: 'Fixed Details: 示例修复说明' }],
};

function folder(t, files) {
  const dir = mkdtempSync(join(tmpdir(), 'claims-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const args = [];
  for (const [name, content] of files.entries()) {
    const path = join(dir, name);
    writeFileSync(path, JSON.stringify(content));
    args.push(path);
  }
  return { dir, args };
}

test('extractDefectClaims maps fields to the fixed predicates and passes the evidenceId through', () => {
  const claims = extractDefectClaims(detailReturn(fullItem).response.result, 'knr_9');
  const predicates = claims.map((c) => c.predicate).sort();
  assert.deepEqual(predicates, ['affects_product', 'affects_version', 'fixed_in_build', 'legacy_issue_id', 'priority', 'repair_note', 'resolution', 'severity', 'status', 'title']);
  for (const claim of claims) {
    assert.equal(claim.subject, 'defect:7');
    assert.equal(claim.origin, 'script');
    assert.deepEqual(claim.evidenceIds, ['knr_9']);
  }
});

test('missing fields yield no claims; nothing is invented', () => {
  const claims = extractDefectClaims({ items: [{ id: '8', state: 'active', title: 't', legacyIssueId: '0', actions: [{ action: 'commented', comment: 'x' }] }] }, 'knr_8');
  assert.deepEqual(claims.map((c) => c.predicate).sort(), ['status', 'title']);
});

test('extract reads hub-saved returns, writes defect_claims.json', (t) => {
  const { dir, args } = folder(t, new Map([['detail.json', detailReturn(fullItem, 'knr_saved')]]));
  const claims = extract(dir, args);
  assert.ok(claims.length >= 10);
  const written = JSON.parse(readFileSync(join(dir, 'defect_claims.json'), 'utf8'));
  assert.equal(written.length, claims.length);
  assert.ok(written.every((c) => c.evidenceIds.includes('knr_saved')));
});

test('a {savedAs} pointer resolves: as given, workspace root, folder', (t) => {
  const dir = mkdtempSync(join(tmpdir(), 'claims-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  mkdirSync(join(dir, 'server-returns'), { recursive: true });
  writeFileSync(join(dir, 'server-returns', 'bug.json'), JSON.stringify(detailReturn(fullItem, 'knr_ptr')));
  mkdirSync(join(dir, 'checks'), { recursive: true });
  const pointer = join(dir, 'checks', 'ptr.json');
  writeFileSync(pointer, JSON.stringify({ savedAs: 'server-returns/bug.json' }));
  const detail = loadDetail(dir, pointer);
  assert.equal(detail.evidenceId, 'knr_ptr');
  const claims = extract(dir, [pointer]);
  assert.ok(claims.every((c) => c.evidenceIds.includes('knr_ptr')));
});

test('several --detail inputs merge; a non-bug_detail return is refused', (t) => {
  const { dir, args } = folder(t, new Map([
    ['a.json', detailReturn(fullItem, 'knr_a')],
    ['b.json', detailReturn({ id: '9', state: 'active', title: 't2' }, 'knr_b')],
  ]));
  const claims = extract(dir, args);
  assert.deepEqual([...new Set(claims.map((c) => c.subject))].sort(), ['defect:7', 'defect:9']);
  const bad = folder(t, new Map([['bad.json', { response: { result: { something: true } } }]]));
  assert.throws(() => extract(bad.dir, bad.args), /not a zentao.bug_detail return/);
});
