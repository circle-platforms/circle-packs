import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { checkStructure, prepBatch } from '../scripts/prep.mjs';
import { mergeReport } from '../scripts/report.mjs';

const good = {
  schema: 'apv.mechanical-case',
  autoid: '100000000000000001',
  description: { intent_verbatim: 't', group_path: ['a'] },
  build: 'Rel_X_1',
  init_commands: ['sdns on'],
  blocks: [
    { kind: 'CONFIG', host: 'APV_0', cmds: ['sdns listener 192.0.2.70'], desc: 'cfg' },
    { kind: 'OBSERVE_ASSERT', host: 'APV_0', cmd: 'show sdns listener', desc: 'see', asserts: [{ op: 'found', pattern: '192\\.0\\.2\\.70', expectation_id: 'u1:100000000000000001:1:0' }] },
    { kind: 'CLIENT', client: 'routera', cmd: 'dig @192.0.2.70 x', asserts: [{ op: 'found', pattern: 'NOERROR', expectation_id: 'u1:100000000000000001:2:0' }] },
  ],
  expectation_binding: [],
  escape_hatches: [],
  command_receipts: [],
};

function batch(t, items) {
  const folder = mkdtempSync(join(tmpdir(), 'review-'));
  t.after(() => {});
  mkdirSync(join(folder, 'cases'), { recursive: true });
  for (const item of items) writeFileSync(join(folder, 'cases', `${item.autoid}.json`), JSON.stringify(item));
  return folder;
}

test('structure: a sound case passes; empty blocks, no checkpoint and long command fail', () => {
  assert.deepEqual(checkStructure(good).violations, []);
  const noBlocks = { ...good, blocks: [] };
  assert.ok(checkStructure(noBlocks).violations.some((v) => v.code === 'blocks_empty'));
  const noCheck = { ...good, blocks: [good.blocks[0]] };
  assert.ok(checkStructure(noCheck).violations.some((v) => v.code === 'no_checkpoint'));
  const long = { ...good, blocks: [{ kind: 'CONFIG', host: 'APV_0', cmds: ['x'.repeat(2001)], desc: '' }] };
  assert.ok(checkStructure(long).violations.some((v) => v.code === 'command_too_long'));
  const badId = { ...good, autoid: '123' };
  assert.ok(checkStructure(badId).violations.some((v) => v.code === 'autoid_invalid'));
});

test('prepBatch writes review_structure.json with per-case verdicts', (t) => {
  const folder = batch(t, [good, { ...good, autoid: '100000000000000002', blocks: [] }]);
  const report = prepBatch(folder);
  assert.equal(report.case_count, 2);
  assert.equal(report.fail_count, 1);
  assert.equal(report.cases['100000000000000001'].ok, true);
  assert.equal(report.cases['100000000000000002'].ok, false);
  const written = JSON.parse(readFileSync(join(folder, 'review_structure.json'), 'utf8'));
  assert.equal(written.case_count, 2);
});

test('mergeReport merges script and model findings and marks origin', (t) => {
  const folder = batch(t, [good]);
  prepBatch(folder);
  writeFileSync(join(folder, 'review_commands.json'), JSON.stringify({
    commands: [
      { autoid: good.autoid, command: 'sdns listener 192.0.2.70', status: 'hit', violations: [], evidenceId: 'evd_1' },
      { autoid: good.autoid, command: 'sdns fulldns on', status: 'missing', violations: [{ code: 'HEAD_MISSING' }], evidenceId: 'evd_2' },
    ],
    clients: [{ autoid: good.autoid, client: 'routera', status: 'enabled' }],
  }));
  writeFileSync(join(folder, 'review_findings.json'), JSON.stringify({
    findings: [{ origin: 'model', autoid: good.autoid, code: 'coverage_gap', summary: '缺负向用例', facts: { defect: '79758' }, evidenceIds: ['evd_3'] }],
  }));
  const report = mergeReport(folder);
  assert.equal(report.totals.cases, 1);
  assert.equal(report.totals.findings, 2);
  assert.equal(report.totals.script_findings, 1);
  assert.equal(report.totals.model_findings, 1);
  const scriptItem = report.items.find((i) => i.origin === 'script');
  assert.equal(scriptItem.code, 'command_not_in_tree');
  assert.deepEqual(scriptItem.evidenceIds, ['evd_2']);
  const modelItem = report.items.find((i) => i.origin === 'model');
  assert.equal(modelItem.code, 'coverage_gap');
  assert.deepEqual(modelItem.evidenceIds, ['evd_3']);
  assert.ok(readFileSync(join(folder, 'review_report.md'), 'utf8').includes('coverage_gap'));
});
