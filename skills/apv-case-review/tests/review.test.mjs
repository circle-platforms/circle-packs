import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { checkStructure, prepBatch, readContext } from '../scripts/prep.mjs';
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

function batch(t, items, { machine = null } = {}) {
  const folder = mkdtempSync(join(tmpdir(), 'review-'));
  t.after(() => rmSync(folder, { recursive: true, force: true }));
  mkdirSync(join(folder, 'cases'), { recursive: true });
  items.forEach((item, i) => writeFileSync(join(folder, 'cases', `${item.autoid ?? `case${i}`}-${i}.json`), JSON.stringify(item)));
  if (machine) writeFileSync(join(folder, 'machine_mindmap.json'), JSON.stringify(machine));
  return folder;
}

const contractBytes = () => JSON.stringify({
  schema: 'ist.excel.function-contract',
  complete: true,
  entries: [
    { e: 'test_env', f: 'routera', status: 'enabled' },
    { e: 'test_env', f: 'console', status: 'disabled' },
  ],
});

function contractFile(t, bytes = contractBytes()) {
  const folder = mkdtempSync(join(tmpdir(), 'contract-'));
  t.after(() => rmSync(folder, { recursive: true, force: true }));
  const path = join(folder, 'contract.json');
  writeFileSync(path, bytes);
  return path;
}

function savedCheck(t, commands, { pointerFor = null, evidenceId = 'evd_check', build = 'Rel_X_1' } = {}) {
  const folder = mkdtempSync(join(tmpdir(), 'saved-'));
  t.after(() => rmSync(folder, { recursive: true, force: true }));
  const path = join(folder, `check-${evidenceId}.json`);
  writeFileSync(path, JSON.stringify({
    tool: 'buildsite.command_check',
    args: {},
    at: '2026-10-13T00:00:00.000Z',
    response: {
      result: { build, commands: commands.map((c) => ({ command: c.command, status: c.status, head: c.head ?? null, violations: c.violations ?? [] })) },
      evidence: [{ evidenceId }],
    },
  }));
  if (pointerFor) {
    const pointer = join(pointerFor, 'checks', 'ptr.json');
    mkdirSync(join(pointerFor, 'checks'), { recursive: true });
    writeFileSync(pointer, JSON.stringify({ savedAs: path }));
    return pointer;
  }
  return path;
}

test('structure: sound case passes; empty blocks, no checkpoint, long command, bad autoid fail', () => {
  assert.deepEqual(checkStructure(good).violations, []);
  assert.ok(checkStructure({ ...good, blocks: [] }).violations.some((v) => v.code === 'blocks_empty'));
  assert.ok(checkStructure({ ...good, blocks: [good.blocks[0]] }).violations.some((v) => v.code === 'no_checkpoint'));
  assert.ok(checkStructure({ ...good, blocks: [{ kind: 'CONFIG', host: 'APV_0', cmds: ['x'.repeat(2001)], desc: '' }] }).violations.some((v) => v.code === 'command_too_long'));
  assert.ok(checkStructure({ ...good, autoid: '123' }).violations.some((v) => v.code === 'autoid_invalid'));
});

test('structure: init_commands checked, unknown blocks flagged, duplicate autoids flagged', (t) => {
  assert.ok(checkStructure({ ...good, init_commands: ['a\nb'] }).violations.some((v) => v.code === 'cmd_config_multiline'));
  assert.ok(checkStructure({ ...good, init_commands: [''] }).violations.some((v) => v.code === 'command_empty'));
  assert.ok(checkStructure({ ...good, blocks: [{ kind: 'WAT' }] }).violations.some((v) => v.code === 'block_unknown'));
  const folder = batch(t, [good, good]);
  const report = prepBatch(folder);
  assert.ok(Object.values(report.cases).some((entry) => entry.violations.some((v) => v.code === 'autoid_duplicate')));
});

test('prepBatch writes review_context.json from machine_mindmap.json', (t) => {
  const machine = {
    build: 'Rel_X_1',
    display_build: 'X 1.0',
    cases: [
      { autoid: '100000000000000001', bucket: 'exp_recipe', contract: { intent: '意图', verification_method: '看', expectation: '显示' }, expectations: [{ n: 1, text: '显示', origin: 'expectation:1' }], proposal: [] },
      { autoid: '100000000000000002', bucket: 'true_gap', proposal: ['缺步骤'] },
    ],
  };
  const folder = batch(t, [good], { machine });
  prepBatch(folder);
  const context = JSON.parse(readFileSync(join(folder, 'review_context.json'), 'utf8'));
  assert.equal(context.build, 'Rel_X_1');
  assert.equal(context.display_build, 'X 1.0');
  const first = context.cases[0];
  assert.equal(first.bucket, 'exp_recipe');
  assert.deepEqual(first.group_path, ['a']); // from the case file, not the machine entry
  assert.equal(first.intent, '意图');
  assert.equal(first.verification, '看');
  assert.equal(first.expectation, '显示');
  assert.deepEqual(first.expectations, [{ n: 1, text: '显示', origin: 'expectation:1' }]);
  const gap = context.cases[1];
  assert.equal(gap.bucket, 'true_gap');
  assert.equal(gap.intent, null);
  assert.deepEqual(gap.proposal, ['缺步骤']);
});

test('structure: an over-long init command is flagged and never collected', (t) => {
  assert.ok(checkStructure({ ...good, init_commands: ['x'.repeat(2001)] }).violations.some((v) => v.code === 'command_too_long' && v.detail === 'init_commands'));
  const folder = batch(t, [{ ...good, init_commands: ['x'.repeat(2001)] }]);
  assert.ok(collectBatch(folder).commands.every((c) => c.command.length <= 2000));
});

test('prep: an unreadable case file is case_unreadable; the rest of the batch still reviews', (t) => {
  const folder = mkdtempSync(join(tmpdir(), 'review-'));
  t.after(() => rmSync(folder, { recursive: true, force: true }));
  mkdirSync(join(folder, 'cases'), { recursive: true });
  writeFileSync(join(folder, 'cases', '0-broken.json'), '{not json');
  writeFileSync(join(folder, 'cases', '1-good.json'), JSON.stringify(good));
  const report = prepBatch(folder);
  assert.equal(report.case_count, 1);
  assert.ok(report.cases['unreadable:0-broken.json'].violations.some((v) => v.code === 'case_unreadable'));
  assert.equal(report.cases['100000000000000001'].ok, true);
});

test('prep: duplicate autoids both stay, keyed autoid#n, both flagged', (t) => {
  const folder = batch(t, [good, good]);
  const report = prepBatch(folder);
  assert.ok(report.cases['100000000000000001']);
  assert.ok(report.cases['100000000000000001#2']);
  assert.ok(report.cases['100000000000000001'].violations.some((v) => v.code === 'autoid_duplicate'));
  assert.ok(report.cases['100000000000000001#2'].violations.some((v) => v.code === 'autoid_duplicate'));
});

test('collectBatch dedupes device commands (init included) with autoids and lists clients', (t) => {
  const folder = batch(t, [good, { ...good, autoid: '100000000000000002' }]);
  const collected = collectBatch(folder);
  assert.equal(collected.commands.length, 3);
  assert.deepEqual(collected.commands.find((c) => c.command === 'sdns on').autoids.sort(), ['100000000000000001', '100000000000000002']);
  assert.deepEqual(collected.clients, [{ client: 'routera', autoids: ['100000000000000001', '100000000000000002'] }]);
});

test('applyCheck: uncovered commands are not_checked without evidenceId; covered ones keep their own evidenceId', (t) => {
  const folder = batch(t, [good]);
  const check = savedCheck(t, [
    { command: 'sdns on', status: 'hit' },
    { command: 'sdns listener 192.0.2.70', status: 'hit' },
  ]);
  const report = applyCheck(folder, [check], contractFile(t), 'Rel_X_1');
  const uncovered = report.commands.find((c) => c.command === 'show sdns listener');
  assert.equal(uncovered.status, 'not_checked');
  assert.equal(uncovered.evidenceId, undefined);
  const covered = report.commands.find((c) => c.command === 'sdns on');
  assert.equal(covered.status, 'hit');
  assert.equal(covered.evidenceId, 'evd_check');
});

test('applyCheck merges several returns, pointers included, per-return evidenceId', (t) => {
  const folder = batch(t, [good]);
  const raw = savedCheck(t, [{ command: 'sdns on', status: 'hit' }, { command: 'sdns listener 192.0.2.70', status: 'hit' }], { evidenceId: 'evd_raw' });
  const pointer = savedCheck(t, [{ command: 'show sdns listener', status: 'hit' }], { evidenceId: 'evd_ptr', pointerFor: folder });
  const report = applyCheck(folder, [raw, pointer], contractFile(t), 'Rel_X_1');
  assert.equal(report.commands.find((c) => c.command === 'show sdns listener').evidenceId, 'evd_ptr');
  assert.equal(report.commands.find((c) => c.command === 'sdns on').evidenceId, 'evd_raw');
  assert.ok(report.commands.every((c) => c.status === 'hit'));
});

test('applyCheck resolves a relative savedAs pointer against the batch folder', (t) => {
  const folder = batch(t, [good]);
  const target = join(folder, 'server-returns', 'check.json');
  mkdirSync(join(folder, 'server-returns'), { recursive: true });
  writeFileSync(target, JSON.stringify({ response: { result: { build: 'Rel_X_1', commands: [{ command: 'sdns on', status: 'hit' }] }, evidence: [{ evidenceId: 'evd_rel' }] } }));
  const pointer = join(folder, 'checks', 'ptr.json');
  mkdirSync(join(folder, 'checks'), { recursive: true });
  writeFileSync(pointer, JSON.stringify({ savedAs: 'server-returns/check.json' }));
  const report = applyCheck(folder, [pointer], contractFile(t), 'Rel_X_1');
  assert.equal(report.commands.find((c) => c.command === 'sdns on').status, 'hit');
});

test('applyCheck: the same command in several returns — agreeing keeps one verdict, disagreeing is inconsistent', (t) => {
  const folder = batch(t, [good]);
  const a = savedCheck(t, [{ command: 'sdns on', status: 'hit' }], { evidenceId: 'evd_a' });
  const b = savedCheck(t, [{ command: 'sdns on', status: 'hit' }], { evidenceId: 'evd_b' });
  const agree = applyCheck(folder, [a, b], contractFile(t), 'Rel_X_1');
  assert.equal(agree.commands.find((c) => c.command === 'sdns on').status, 'hit');
  const c = savedCheck(t, [{ command: 'sdns on', status: 'missing', violations: [{ code: 'HEAD_MISSING' }] }], { evidenceId: 'evd_c' });
  const clash = applyCheck(folder, [a, c], contractFile(t), 'Rel_X_1');
  const entry = clash.commands.find((x) => x.command === 'sdns on');
  assert.equal(entry.status, 'inconsistent');
  assert.deepEqual(entry.evidenceIds.sort(), ['evd_a', 'evd_c']);
  writeFileSync(join(folder, 'review_commands.json'), JSON.stringify(clash));
  const report = mergeReport(folder);
  assert.ok(report.items.some((i) => i.code === 'command_check_inconsistent' && i.autoid === good.autoid));
});

test('applyCheck: a return without result.build is build_unverified, not skipped', (t) => {
  const folder = batch(t, [good]);
  const noBuild = savedCheck(t, [{ command: 'sdns on', status: 'hit' }]);
  const saved = JSON.parse(readFileSync(noBuild, 'utf8'));
  delete saved.response.result.build;
  writeFileSync(noBuild, JSON.stringify(saved));
  const report = applyCheck(folder, [noBuild], contractFile(t), 'Rel_X_1');
  assert.ok(report.problems.some((p) => p.code === 'build_unverified' && p.detail.includes(noBuild.split('/').pop())));
});

test('report: an unknown command status surfaces as command_status_unknown', (t) => {
  const folder = batch(t, [good]);
  prepBatch(folder);
  writeFileSync(join(folder, 'review_commands.json'), JSON.stringify({ problems: [], build: 'Rel_X_1', commands: [{ command: 'sdns on', autoids: [good.autoid], status: 'weird', violations: [] }], clients: [] }));
  const report = mergeReport(folder);
  const item = report.items.find((i) => i.code === 'command_status_unknown');
  assert.ok(item);
  assert.equal(item.facts.status, 'weird');
});

test('report: claims carry evidenceIds in value and use build:<bound build> for case-less findings', (t) => {
  const folder = batch(t, [good]);
  prepBatch(folder);
  writeFileSync(join(folder, 'review_commands.json'), JSON.stringify({
    problems: [{ code: 'build_mismatch', detail: 'x' }],
    build: 'Rel_X_1',
    commands: [{ command: 'sdns on', autoids: [good.autoid], status: 'missing', violations: [], evidenceId: 'evd_9' }],
    clients: [],
  }));
  const report = mergeReport(folder);
  const claims = JSON.parse(readFileSync(join(folder, 'review_claims.json'), 'utf8'));
  const notInTree = claims.find((c) => c.predicate === 'command_not_in_tree');
  assert.equal(notInTree.subject, `case:${good.autoid}`);
  assert.deepEqual(notInTree.value.evidenceIds, ['evd_9']);
  const mismatch = claims.find((c) => c.predicate === 'build_mismatch');
  assert.equal(mismatch.subject, 'build:Rel_X_1');
  assert.ok(JSON.stringify(claims).indexOf(folder) === -1);
});

test('applyCheck: build mismatch against the return and against a case', (t) => {
  const folder = batch(t, [good]);
  const otherBuild = savedCheck(t, [{ command: 'sdns on', status: 'hit' }], { build: 'Rel_Y_9' });
  const report = applyCheck(folder, [otherBuild], contractFile(t), 'Rel_X_1');
  assert.ok(report.problems.some((p) => p.code === 'build_mismatch'));
  const caseMismatch = batch(t, [{ ...good, build: 'Rel_Y_9' }]);
  const ok = savedCheck(t, [{ command: 'sdns on', status: 'hit' }]);
  assert.ok(applyCheck(caseMismatch, [ok], contractFile(t), 'Rel_X_1').problems.some((p) => p.code === 'build_mismatch'));
});

test('applyCheck: clients without a contract are client_not_checked; a disabled one is client_not_in_contract', (t) => {
  const folder = batch(t, [good, { ...good, autoid: '100000000000000002', blocks: [{ kind: 'CLIENT', client: 'console', cmd: 'x', asserts: [{ op: 'found', pattern: 'x' }] }] }]);
  const check = savedCheck(t, [{ command: 'sdns on', status: 'hit' }]);
  const noContract = applyCheck(folder, [check], null, 'Rel_X_1');
  assert.ok(noContract.clients.every((c) => c.status === 'client_not_checked'));
  const withContract = applyCheck(folder, [check], contractFile(t), 'Rel_X_1');
  assert.equal(withContract.clients.find((c) => c.client === 'routera').status, 'enabled');
  assert.equal(withContract.clients.find((c) => c.client === 'console').status, 'client_not_in_contract');
});

test('contractClients rejects a non-contract schema', (t) => {
  assert.throws(() => contractClients(contractFile(t, '{"schema":"nope"}')));
});

test('mergeReport expands per-case findings, codes them, and writes claims ready to submit', (t) => {
  const folder = batch(t, [good]);
  prepBatch(folder);
  writeFileSync(join(folder, 'review_commands.json'), JSON.stringify({
    problems: [],
    commands: [
      { command: 'sdns listener 192.0.2.70', autoids: ['100000000000000001'], status: 'hit', violations: [], evidenceId: 'evd_1' },
      { command: 'sdns fulldns on', autoids: ['100000000000000001'], status: 'missing', violations: [{ code: 'HEAD_MISSING' }], evidenceId: 'evd_2' },
      { command: 'sdns stray', autoids: ['100000000000000001'], status: 'not_checked', violations: [] },
      { command: 'sdns host name x', autoids: ['100000000000000001'], status: 'hit', violations: [{ code: 'ARGUMENT_COUNT' }], evidenceId: 'evd_4' },
    ],
    clients: [{ client: 'routera', autoids: ['100000000000000001'], status: 'enabled' }],
  }));
  writeFileSync(join(folder, 'review_findings.json'), JSON.stringify({
    findings: [{ origin: 'model', autoid: good.autoid, code: 'coverage_gap', summary: '缺负向用例', facts: { defect: '79758' }, evidenceIds: ['evd_3'] }],
  }));
  const report = mergeReport(folder);
  const codes = report.items.map((i) => i.code);
  assert.ok(codes.includes('command_not_in_tree'));
  assert.ok(codes.includes('command_not_checked'));
  assert.ok(codes.includes('command_parameter_contract'));
  assert.ok(codes.includes('coverage_gap'));
  const notChecked = report.items.find((i) => i.code === 'command_not_checked');
  assert.equal(notChecked.autoid, '100000000000000001');
  assert.equal(notChecked.facts.command, 'sdns stray');
  assert.deepEqual(notChecked.evidenceIds, []);
  const claims = JSON.parse(readFileSync(join(folder, 'review_claims.json'), 'utf8'));
  assert.ok(claims.every((c) => c.subject && c.predicate && c.value));
  assert.equal(claims.find((c) => c.predicate === 'coverage_gap').subject, 'case:100000000000000001');
  const md = readFileSync(join(folder, 'review_report.md'), 'utf8');
  assert.ok(md.includes('review_report.json'));
  assert.ok(md.includes(report.sha256));
});

test('mergeReport refuses a finding code outside the enum', (t) => {
  const folder = batch(t, [good]);
  prepBatch(folder);
  writeFileSync(join(folder, 'review_findings.json'), JSON.stringify({ findings: [{ origin: 'model', code: 'not_a_code', summary: 'x' }] }));
  assert.throws(() => mergeReport(folder), /outside/);
});

test('end to end: prep → collect → apply (raw + pointer) → report on a mixed batch', (t) => {
  const machine = {
    build: 'Rel_X_1',
    cases: [
      { autoid: '100000000000000001', bucket: 'exp_recipe', contract: { intent: 'i1', verification_method: 'v', expectation: 'e' }, expectations: [{ n: 1, text: 'e', origin: 'expectation:1' }], proposal: [] },
    ],
  };
  const folder = batch(t, [good, { ...good, autoid: '100000000000000002', blocks: [{ kind: 'CLIENT', client: 'console', cmd: 'x', asserts: [{ op: 'found', pattern: 'x' }] }] }], { machine });
  const structure = prepBatch(folder);
  assert.equal(structure.fail_count, 0);
  assert.ok(readFileSync(join(folder, 'review_context.json'), 'utf8').includes('i1'));
  const collected = collectBatch(folder);
  const raw = savedCheck(t, collected.commands.filter((c) => c.command !== 'show sdns listener').map((c) => ({ command: c.command, status: 'hit' })), { evidenceId: 'evd_a' });
  const pointer = savedCheck(t, [{ command: 'show sdns listener', status: 'hit', violations: [{ code: 'ARGUMENT_COUNT' }] }], { evidenceId: 'evd_b', pointerFor: folder });
  const applied = applyCheck(folder, [raw, pointer], contractFile(t), 'Rel_X_1');
  assert.equal(applied.problems.length, 0);
  const report = mergeReport(folder);
  assert.equal(report.totals.cases, 2);
  assert.ok(report.items.some((i) => i.code === 'command_parameter_contract' && i.evidenceIds.includes('evd_b')));
  assert.ok(report.items.some((i) => i.code === 'client_not_in_contract' && i.autoid === '100000000000000002'));
});

test('an empty cases folder yields zero cases, not an error', (t) => {
  const folder = mkdtempSync(join(tmpdir(), 'review-empty-'));
  t.after(() => rmSync(folder, { recursive: true, force: true }));
  mkdirSync(join(folder, 'cases'), { recursive: true });
  const report = prepBatch(folder);
  assert.equal(report.case_count, 0);
  assert.equal(report.fail_count, 0);
});
