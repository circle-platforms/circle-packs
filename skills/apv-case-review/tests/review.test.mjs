import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { checkStructure, prepBatch } from '../scripts/prep.mjs';
import { collectBatch, applyCheck, contractClients } from '../scripts/check.mjs';
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
  t.after(() => rmSync(folder, { recursive: true, force: true }));
  mkdirSync(join(folder, 'cases'), { recursive: true });
  for (const item of items) writeFileSync(join(folder, 'cases', `${item.autoid}.json`), JSON.stringify(item));
  return folder;
}

const CONTRACT_PATH = (() => {
  const path = join(mkdtempSync(join(tmpdir(), 'contract-')), 'contract.json');
  writeFileSync(path, JSON.stringify({
    schema: 'ist.excel.function-contract',
    complete: true,
    entries: [
      { e: 'test_env', f: 'routera', status: 'enabled' },
      { e: 'test_env', f: 'console', status: 'disabled' },
    ],
  }));
  return path;
})();

function savedCheck(t, commands) {
  const folder = mkdtempSync(join(tmpdir(), 'saved-'));
  t.after(() => rmSync(folder, { recursive: true, force: true }));
  const path = join(folder, 'check.json');
  writeFileSync(path, JSON.stringify({
    tool: 'buildsite.command_check',
    args: {},
    at: '2026-10-13T00:00:00.000Z',
    response: {
      result: { build: 'Rel_X_1', commands: commands.map((c) => ({ command: c.command, status: c.status, head: c.head ?? null, violations: c.violations ?? [] })) },
      evidence: [{ evidenceId: 'evd_check' }],
    },
  }));
  return path;
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

test('prepBatch writes review_structure.json with per-case verdicts and case# keys for missing autoids', (t) => {
  const folder = batch(t, [good, { ...good, autoid: '100000000000000002', blocks: [] }]);
  const report = prepBatch(folder);
  assert.equal(report.case_count, 2);
  assert.equal(report.fail_count, 1);
  assert.equal(report.cases['100000000000000001'].ok, true);
  assert.equal(report.cases['100000000000000002'].ok, false);
  const written = JSON.parse(readFileSync(join(folder, 'review_structure.json'), 'utf8'));
  assert.equal(written.case_count, 2);
});

test('collectBatch dedupes device commands with their autoids and lists clients', (t) => {
  const folder = batch(t, [good, { ...good, autoid: '100000000000000002' }]);
  const collected = collectBatch(folder);
  assert.equal(collected.commands.length, 3); // sdns on, sdns listener, show sdns listener
  assert.deepEqual(collected.commands.find((c) => c.command === 'sdns on').autoids.sort(), ['100000000000000001', '100000000000000002']);
  assert.deepEqual(collected.clients, [{ client: 'routera', autoids: ['100000000000000001', '100000000000000002'] }]);
});

test('applyCheck takes verdicts from the hub-saved return and checks clients against the contract', (t) => {
  const folder = batch(t, [good]);
  const check = savedCheck(t, [
    { command: 'sdns on', status: 'hit' },
    { command: 'sdns listener 192.0.2.70', status: 'hit' },
    { command: 'show sdns listener', status: 'missing', violations: [{ code: 'HEAD_MISSING' }] },
  ]);
  const report = applyCheck(folder, check, CONTRACT_PATH);
  assert.equal(report.build, 'Rel_X_1');
  assert.equal(report.commands.find((c) => c.command === 'show sdns listener').status, 'missing');
  assert.equal(report.commands.find((c) => c.command === 'sdns on').evidenceId, 'evd_check');
  assert.equal(report.clients[0].status, 'enabled');
  const noContract = applyCheck(folder, check, null);
  assert.equal(noContract.clients[0].status, 'not_checked');
  const written = JSON.parse(readFileSync(join(folder, 'review_commands.json'), 'utf8'));
  assert.equal(written.commands.length, 3);
});

test('contractClients reads only enabled test_env entries', () => {
  const clients = contractClients(CONTRACT_PATH);
  assert.ok(clients.has('routera'));
  assert.ok(!clients.has('console'));
});

test('mergeReport merges script and model findings, marks origin and rejects unknown finding codes', (t) => {
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

  writeFileSync(join(folder, 'review_findings.json'), JSON.stringify({ findings: [{ origin: 'model', code: 'not_a_code', summary: 'x' }] }));
  assert.throws(() => mergeReport(folder), /outside/);
});
