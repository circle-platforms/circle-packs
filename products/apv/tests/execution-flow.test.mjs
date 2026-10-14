import { test } from 'node:test';
import assert from 'node:assert/strict';
import { normalizeIpv6, ipVersion, deviceAddress, environmentDevices, environmentBuild } from '../tools/environment.ts';
import { refusalFacts } from '../tools/refusal.ts';
import { validateTransitionOutput, finiteJsonOk, FLOW_VERSION, TRANSITION_SCHEMA, OUTCOME_CODES, projectCommandTree } from '../tools/execution-contracts.ts';
import { transition } from '../tools/execution-transition.ts';
import { createHash } from '../tools/sha256.ts';

// ---------- sha256 (dependency-free) ----------
test('the dependency-free sha256 matches known vectors', () => {
  assert.equal(createHash(new TextEncoder().encode('')), 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855');
  assert.equal(createHash(new TextEncoder().encode('abc')), 'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
});

// ---------- command-tree projection (高1) ----------
test('projectCommandTree computes present from the frozen command-check original, never self-reported', () => {
  // the sync tool's own shape: {result:{commands:[{command,status,violations}]}}
  const check = new TextEncoder().encode(JSON.stringify({ result: { commands: [
    { command: 'sdns on', status: 'hit', violations: [] },
    { command: 'service inspect alpha', status: 'hit', violations: [] },
    { command: 'sdns host name x', status: 'hit', violations: [{ code: 'ARGUMENT_COUNT' }] }, // hit but violating
    { command: 'sdns fulldns on', status: 'missing', violations: [{ code: 'HEAD_MISSING' }] },
  ] } }));
  const projected = projectCommandTree(check, ['sdns on', 'sdns host name x', 'sdns fulldns on']);
  assert.deepEqual(projected.heads, [
    { command: 'sdns on', present: true },
    { command: 'sdns host name x', present: false }, // violations disprove presence
    { command: 'sdns fulldns on', present: false },
  ]);
  assert.throws(() => projectCommandTree(new TextEncoder().encode('{oops'), []), /not valid UTF-8 JSON/);
  assert.throws(() => projectCommandTree(new TextEncoder().encode('{"result":{"commands":{}}}'), []), /no usable command list/);
});

// ---------- environment normalization (中11) ----------
test('ipVersion accepts what node:net accepts; normalizeIpv6 canonicalizes every spelling', () => {
  assert.equal(ipVersion('192.0.2.1'), 4);
  assert.equal(ipVersion('2001:db8::10'), 6);
  assert.equal(ipVersion(':::1'), 0);
  assert.equal(ipVersion('256.1.1.1'), 0);
  assert.equal(normalizeIpv6('2001:DB8::0010'), '2001:db8::10');
  assert.equal(normalizeIpv6('::ffff:192.0.2.1'), '::ffff:c000:201');
  assert.equal(deviceAddress('2001:db8:0:0:0:0:0:10'), '2001:db8::10');
});

test('environmentDevices sources and refusals', () => {
  assert.equal(environmentDevices({ environment: { device_count: 2, conf: { device_ips: ['192.0.2.10', '192.0.2.11'] } } }).source, 'gateway.env_prepare.conf.device_ips');
  assert.equal(environmentDevices({ environment: { device_count: 2, conf: { device_ips: ['192.0.2.10', '192.0.2.10'] } } }), null);
  const ok = environmentBuild({ ready: true, build_checked: true, checks: [{ check: 'device_build', ok: true, detail: 'device reports SYN_1, gateway bundle is SYN_1' }] }, 'SYN_1');
  assert.equal(ok.passed, true);
  assert.equal(environmentBuild({ ready: true, build_checked: true, observedBuild: 'SYN_9' }, 'SYN_1').passed, false);
});

test('refusalFacts reads the gateway original; unknown text stays dispatch-unproven', () => {
  const legacy = refusalFacts({ ok: false, reason: "expected exactly one 'IST_EXCEL_CONTRACT' identity marker, found 0" });
  assert.equal(legacy.preDispatch, true);
  const declared = refusalFacts({ ok: false, stage: 'environment', code: 'BUILD_MISMATCH', reason: 'device reports other build' });
  assert.equal(declared.code, 'BUILD_MISMATCH');
  const bare = refusalFacts({ ok: false, reason: 'opaque' });
  assert.equal(bare.preDispatch, false);
});

// ---------- contracts ----------
test('outcome codes are registered; the state budget holds; shared references pass', () => {
  for (const code of ['HOST_NOT_IN_BED', 'HOST_SET_UNDECLARED', 'COMMAND_NOT_LITERAL', 'HOST_COMMAND_OUTSIDE_POLICY']) assert.ok(!OUTCOME_CODES.includes(code), `${code} is a hook rule code, not an outcome code`);
  assert.ok(OUTCOME_CODES.includes('HOOK_FAILED'));
  const shared = { node: { id: 1 } };
  assert.ok(finiteJsonOk({ a: shared, b: shared }));
  const cycle = { self: null };
  cycle.self = cycle;
  assert.ok(!finiteJsonOk(cycle));
  assert.ok(validateTransitionOutput({ schema: TRANSITION_SCHEMA, state: { blob: 'x'.repeat(256 * 1024 + 1) }, actions: [] }).some((p) => /state over/.test(p)));
  assert.equal(FLOW_VERSION, 'apv-case-execute/2');
});

// ---------- transition on hub-shaped inputs ----------
const submission = (value) => ({ deadlineMs: 3600000, flowId: 'apv-case-execute-v2', methodPin: { assetId: 'ast_method' }, resources: { gateway: { assetId: 'ast_gateway' } }, sources: { originals: { assetId: 'ast_source' } }, value, controlledBytes: [] });
// The workbook projection the in-flow tool.call produced — commands and hosts come
// from the frozen workbook, not from the client value.
const BOOK = {
  sha256: 'f'.repeat(64),
  commands: [{ command: 'service inspect alpha', autoid: '301', row: 10, object: 'APV_0' }],
  hostCommands: [{ command: 'echo synthetic', host: 'routera', method: 'routera', kwargs: {}, row: 11 }],
  cases: [{ autoid: '301' }],
};
const input = (state, observations, value = {}) => ({
  schema: TRANSITION_SCHEMA,
  binding: { taskId: 'synthetic-task' },
  currentInput: { value: submission({ build: 'SYNTHETIC_BUILD_301', ...value }), sha256: '0'.repeat(64) },
  state,
  observations,
  controlledBytes: [{ slot: 'workbook', role: 'workbook', reference: { kind: 'source', sourceRevisionId: 'src_w', sha256: 'f'.repeat(64), size: 4 }, contentBase64: '' }],
});
const obs = (stepId, facts, operationId = `op-${stepId}`) => ({ operationId, reference: { kind: 'artifact', artifactId: `art_${stepId}`, sha256: '0'.repeat(64), size: 1 }, facts: { stepId, status: 'succeeded', ...facts } });

test('workbook stage parses the frozen workbook before anything else (高2)', () => {
  const first = transition(input({ stage: 'workbook' }, []));
  assert.equal(first.state.stage, 'workbook');
  assert.equal(first.actions[0].kind, 'tool.call');
  assert.equal(first.actions[0].path, 'tools/workbook.ts');
  assert.deepEqual(first.actions[0].byteSlots, ['workbook', 'function-contract']);
  assert.deepEqual(first.actions[0].args, []);
  const after = transition(input({ stage: 'workbook' }, [obs('workbook', { result: BOOK })]));
  assert.equal(after.state.stage, 'environment');
  assert.equal(after.actions[0].tool, 'env_prepare');
  assert.equal(after.actions[0].resource, 'gateway');
});

test('environment → topology → device-map → tree, gates built from the book and the tree (高1/高2)', () => {
  const env = obs('environment', { result: { device_count: 1, conf: { device_ips: ['192.0.2.11'] }, ready: true, build_checked: true, checks: [{ check: 'device_build', ok: true, detail: 'device reports SYNTHETIC_BUILD_301, gateway bundle is SYNTHETIC_BUILD_301' }] } });
  const withConf = transition(input({ stage: 'environment' }, [env]));
  assert.equal(withConf.state.stage, 'device-map'); // no topology detour
  const noConf = transition(input({ stage: 'environment' }, [obs('environment', { result: { device_count: 1 } })]));
  assert.equal(noConf.state.stage, 'topology');
  const map = obs('device-map', { result: { addresses: [['192.0.2.11']], source: 'gateway.env_prepare.conf.device_ips' } });
  const toTree = transition(input({ stage: 'device-map' }, [env, map]));
  assert.equal(toTree.state.stage, 'tree');
  assert.equal(toTree.actions[0].byteSlots[0], 'command-check'); // the frozen command-check original
  const heads = [{ command: 'service inspect alpha', present: true }];
  const gates = transition(input({ stage: 'tree' }, [obs('tree', { result: { heads } }), obs('workbook', { result: BOOK })]));
  assert.equal(gates.state.stage, 'verify');
  const device = gates.actions.find((a) => a.event === 'verify.deviceCommand');
  assert.deepEqual(device.subject.tree.heads, heads); // present comes from the projection
  const host = gates.actions.find((a) => a.event === 'verify.hostCommand');
  assert.equal(host.subject.host, 'routera'); // from the book, per host
  const wb = gates.actions.find((a) => a.event === 'verify.workbook');
  assert.equal(wb.subject.client, 'routera'); // per distinct book host
  const mismatch = transition(input({ stage: 'device-map' }, [obs('environment', { result: { device_count: 1, conf: { device_ips: ['192.0.2.11'] }, ready: true, build_checked: true, checks: [{ check: 'device_build', ok: true, detail: 'device reports OTHER, gateway bundle is SYNTHETIC_BUILD_301' }] } }), map]));
  assert.equal(mismatch.actions[0].code, 'BUILD_MISMATCH');
});

test('verify: a blocked gate fails with HOOK_FAILED and the rule code in facts (中5)', () => {
  const blocked = obs('verify-device-0', { status: 'failed', error: { code: 'HOOK_FAILED', details: { code: 'COMMAND_NOT_IN_TREE' } } });
  const out = transition(input({ stage: 'verify' }, [blocked, obs('verify-host-0', {}), obs('verify-workbook-0', {}), obs('workbook', { result: BOOK })]));
  assert.equal(out.state.stage, 'failed');
  assert.equal(out.actions[0].code, 'HOOK_FAILED');
  assert.equal(out.actions[0].facts.code, 'COMMAND_NOT_IN_TREE');
});

test('submit: byte slot only, no inline base64; status-shaped receipts go through the result tool (中7/中10)', () => {
  const verifies = [obs('verify-device-0', {}), obs('verify-host-0', {}), obs('verify-workbook-0', {})];
  const out = transition(input({ stage: 'verify' }, [...verifies, obs('workbook', { result: BOOK })]));
  assert.equal(out.state.stage, 'submit');
  const submit = out.actions[0];
  assert.equal(submit.tool, 'case_submit');
  assert.deepEqual(submit.byteArgs, { xlsx_b64: 'workbook' });
  assert.ok(!Object.hasOwn(submit.args, 'xlsx_b64'));
  // a status-shaped receipt (reconcile) is not parsed directly: fetch the result first
  const statusShaped = obs('submit', { result: { state: 'done', task_id: 'synthetic_apv_task_301' } });
  const reconciled = transition(input({ stage: 'submit' }, [statusShaped]));
  assert.equal(reconciled.state.stage, 'result');
  assert.equal(reconciled.actions[0].tool, 'case_results');
  assert.equal(reconciled.actions[0].args.task_id, 'synthetic_apv_task_301');
});

test('parse and delivery: results via byteSlots, projected or failed parses deliver partial (中6/中14)', () => {
  const done = transition(input({ stage: 'submit' }, [obs('submit', { result: { channel: 'ready', rc: 0, cases: [{ case_id: '301', result: 'PASS', log_stale: false, log: '' }] } }), obs('workbook', { result: BOOK })]));
  assert.equal(done.state.stage, 'parse');
  const parse = done.actions[0];
  assert.deepEqual(parse.byteSlots, ['workbook']); // results ride the provider observation, args stay small
  assert.equal(parse.args[0], BOOK); // the book comes from the frozen workbook observation
  assert.equal(parse.args[1].channel, 'ready');
  const clean = transition(input({ stage: 'afterResult' }, [obs('after-result', {}), obs('parse-results', { result: { cases: [], unmapped: [] } })]));
  assert.equal(clean.actions[0].status, 'succeeded');
  const projected = transition(input({ stage: 'afterResult' }, [obs('after-result', {}), obs('parse-results', { result: { original: { reference: { kind: 'artifact', artifactId: 'a', sha256: '0'.repeat(64), size: 9 }, slot: 'hub.result.x' } } })]));
  assert.equal(projected.actions[0].status, 'partial');
  const parseFailed = transition(input({ stage: 'parse' }, [obs('parse-results', { status: 'failed', error: { code: 'HOOK_FAILED' } })]));
  assert.equal(parseFailed.state.stage, 'afterResult'); // not failed — delivery degrades
  const delivered = transition(input({ stage: 'afterResult' }, [obs('after-result', {})]));
  assert.equal(delivered.actions[0].status, 'partial');
});

test('refusals: the gateway original lives in facts.result (高3)', () => {
  const refused = transition(input({ stage: 'submit' }, [obs('submit', { status: 'failed', result: { ok: false, stage: 'validation', reason: "expected exactly one 'IST_EXCEL_CONTRACT' identity marker, found 0" } })]));
  assert.equal(refused.actions[0].code, 'GATEWAY_REFUSED');
  assert.equal(refused.actions[0].facts.refusal.classification, 'legacy-contract-diagnostic');
  const buildRefused = transition(input({ stage: 'environment' }, [obs('environment', { status: 'failed', result: { ok: false, stage: 'environment', code: 'BUILD_MISMATCH', reason: 'device reports other build' } })]));
  assert.equal(buildRefused.actions[0].code, 'BUILD_MISMATCH'); // the gateway's own code survives
});

test('every stage output passes the A2 validation', () => {
  for (const stage of ['workbook', 'environment', 'topology', 'device-map', 'tree', 'verify', 'submit', 'wait', 'result', 'parse', 'afterResult']) {
    for (const observations of [[], [obs('workbook', { result: BOOK })], [obs('environment', { result: { device_count: 1 } })]]) {
      const output = transition(input({ stage }, observations));
      assert.deepEqual(validateTransitionOutput(output), [], `${stage} / ${observations.length}`);
    }
  }
});
