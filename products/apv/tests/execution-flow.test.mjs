import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ipVersion, deviceAddress, environmentDevices, environmentBuild } from '../tools/environment.ts';
import { refusalFacts } from '../tools/refusal.ts';
import { validateTransitionOutput, finiteJsonOk, FLOW_VERSION, TRANSITION_SCHEMA } from '../tools/execution-contracts.ts';
import { transition } from '../tools/execution-transition.ts';

// --- environment: IP validation (own, replacing node:net) ---
test('ipVersion validates IPv4 and IPv6 shapes including compression and v4-in-v6', () => {
  assert.equal(ipVersion('192.0.2.1'), 4);
  assert.equal(ipVersion('203.0.113.213'), 4);
  assert.equal(ipVersion('2001:db8::10'), 6);
  assert.equal(ipVersion('::'), 6);
  assert.equal(ipVersion('3ffc::ac10:21d8'), 6);
  assert.equal(ipVersion('::ffff:192.0.2.1'), 6);
  assert.equal(ipVersion('256.1.1.1'), 0);
  assert.equal(ipVersion('1.2.3'), 0);
  assert.equal(ipVersion('192.0.2.1/24'), 0);
  assert.equal(ipVersion('2001::db8::1'), 0);
  assert.equal(ipVersion('not-an-ip'), 0);
  assert.equal(deviceAddress('[2001:DB8::10]'), '2001:db8::10');
  assert.equal(deviceAddress('192.0.2.1'), '192.0.2.1');
  assert.equal(deviceAddress('hostname'), null);
});

// --- environment: device mapping, three sources in priority order ---
test('environmentDevices prefers conf.device_ips, then applies_to, then LB devices', () => {
  const byConf = environmentDevices({ environment: { device_count: 2, conf: { device_ips: ['192.0.2.10', '192.0.2.11'] } } });
  assert.deepEqual(byConf, { addresses: [['192.0.2.10'], ['192.0.2.11']], source: 'gateway.env_prepare.conf.device_ips' });
  const bySsh = environmentDevices({ environment: { device_count: 2 }, topology: { topology: { applies_to: { device_ssh_ips: ['192.0.2.10', '192.0.2.11'] } } } });
  assert.equal(bySsh.source, 'gateway.bed_topology.applies_to.device_ssh_ips');
  const byDevices = environmentDevices({ environment: { device_count: 2 }, topology: { topology: { devices: [
    { name: 'clientC', type: '客户端', ipv4: ['192.0.2.30/24'] },
    { name: 'APV0', type: '负载均衡', ipv4: ['192.0.2.10/24'] },
    { name: 'APV1', type: '负载均衡', ipv4: ['192.0.2.11/24'] },
  ] } } });
  assert.deepEqual(byDevices.addresses, [['192.0.2.10'], ['192.0.2.11']]);
  assert.equal(byDevices.source, 'gateway.bed_topology.devices');
});

test('environmentDevices returns null on ambiguity, count mismatch or missing LBs', () => {
  assert.equal(environmentDevices({ environment: { device_count: 2, conf: { device_ips: ['192.0.2.10', '192.0.2.10'] } } }), null, 'duplicate ip');
  assert.equal(environmentDevices({ environment: { device_count: 3, conf: { device_ips: ['192.0.2.10', '192.0.2.11'] } } }), null, 'count mismatch');
  assert.equal(environmentDevices({ environment: { device_count: 2 }, topology: { topology: { devices: [{ name: 'APV0', type: '负载均衡', ipv4: ['192.0.2.10/24'] }] } } }), null, 'one LB for two devices');
  assert.equal(environmentDevices({}), null, 'no attribution');
});

test('environmentBuild passes only on ready + build_checked + exact detail match', () => {
  const ok = environmentBuild({ ready: true, build_checked: true, checks: [{ check: 'device_build', ok: true, detail: 'device reports Synth_9_9_0_585, gateway bundle is Synth_9_9_0_585' }] }, 'Synth_9_9_0_585');
  assert.equal(ok.passed, true);
  assert.equal(ok.observedBuild, 'Synth_9_9_0_585');
  const mismatch = environmentBuild({ ready: true, build_checked: true, checks: [{ check: 'device_build', ok: true, detail: 'device reports Synth_9_9_0_584, gateway bundle is Synth_9_9_0_585' }] }, 'Synth_9_9_0_585');
  assert.equal(mismatch.passed, false);
});

// --- refusal ---
test('refusalFacts classifies legacy contract diagnostics as pre-dispatch validation', () => {
  const legacy = refusalFacts({ ok: false, reason: "expected exactly one 'IST_EXCEL_CONTRACT' identity marker, found 0" });
  assert.equal(legacy.preDispatch, true);
  assert.equal(legacy.stage, 'validation');
  assert.equal(legacy.classification, 'legacy-contract-diagnostic');
  assert.equal(legacy.code, 'GATEWAY_REFUSED');
  const declared = refusalFacts({ ok: false, stage: 'environment', code: 'BUILD_MISMATCH', reason: 'device reports other build' });
  assert.equal(declared.preDispatch, true);
  assert.equal(declared.code, 'BUILD_MISMATCH');
  const dispatched = refusalFacts({ ok: false, stage: 'environment', task_id: 'synthetic-task', dispatched: true });
  assert.equal(dispatched.preDispatch, false);
  assert.equal(dispatched.classification, 'gateway-declared-stage');
});

// --- contracts: budgets and finite-JSON guard ---
test('finiteJsonOk rejects the values A2 excludes', () => {
  assert.ok(finiteJsonOk({ a: [1, 'x', null, true] }));
  assert.ok(!finiteJsonOk({ a: NaN }));
  assert.ok(!finiteJsonOk({ a: undefined }));
  assert.ok(!finiteJsonOk({ a: 1n }));
  assert.ok(!finiteJsonOk({ a: new Date() }));
  assert.ok(!finiteJsonOk({ a: new Map() }));
  const cycle = { self: null };
  cycle.self = cycle;
  assert.ok(!finiteJsonOk(cycle));
  const sparse = [1];
  sparse[3] = 4;
  assert.ok(!finiteJsonOk(sparse));
});

test('validateTransitionOutput enforces the action vocabulary, identities and budgets', () => {
  const ok = { schema: TRANSITION_SCHEMA, state: { stage: 'lease' }, actions: [{ kind: 'operation.wait', stepId: 'wait-status', occurrence: 0, operationId: 'op-1' }] };
  assert.deepEqual(validateTransitionOutput(ok), []);
  const badKind = { schema: TRANSITION_SCHEMA, state: {}, actions: [{ kind: 'sql.exec', stepId: 'x', occurrence: 0 }] };
  assert.ok(validateTransitionOutput(badKind).some((p) => /unknown action kind/.test(p)));
  const dup = { schema: TRANSITION_SCHEMA, state: {}, actions: [
    { kind: 'operation.wait', stepId: 'a', occurrence: 0, operationId: 'op' },
    { kind: 'operation.wait', stepId: 'a', occurrence: 0, operationId: 'op' },
  ] };
  assert.ok(validateTransitionOutput(dup).some((p) => /duplicate step identity/.test(p)));
  const overlap = { schema: TRANSITION_SCHEMA, state: {}, actions: [{ kind: 'provider.call', stepId: 's', occurrence: 0, resource: 'g', tool: 't', args: { workbook_b64: 'x' }, byteArgs: { workbook_b64: 'workbook' } }] };
  assert.ok(validateTransitionOutput(overlap).some((p) => /byteArgs overlaps args/.test(p)));
  const overString = { schema: TRANSITION_SCHEMA, state: { blob: 'x'.repeat(32 * 1024 + 1) }, actions: [] };
  assert.ok(validateTransitionOutput(overString).some((p) => /string over/.test(p)));
  assert.equal(FLOW_VERSION, 'apv-case-execute/2');
});

// --- transition: the staged walk on synthetic observations ---
const input = (state, observations, value = {}) => ({
  schema: TRANSITION_SCHEMA,
  binding: { taskId: 'synthetic-task' },
  currentInput: { value: { build: 'Synth_9_9_0_585', gatewayAssetId: 'ast_gateway', ...value }, sha256: '0'.repeat(64) },
  state,
  observations,
  controlledBytes: [],
});
const obs = (stepId, facts, operationId = `op-${stepId}`) => ({ operationId, reference: { kind: 'evidenceId', id: `evd_${stepId}`, sha256: '0'.repeat(64), size: 1 }, facts: { stepId, status: 'succeeded', ...facts } });

test('transition walks lease → environment → topology → device-map on synthetic facts', () => {
  const lease = transition(input({ stage: 'lease' }, []));
  assert.equal(lease.state.stage, 'leasing');
  assert.equal(lease.actions[0].tool, 'lease_acquire');
  const afterLease = transition(input({ stage: 'lease' }, [obs('lease', { result: {} })]));
  assert.equal(afterLease.state.stage, 'environment');
  assert.equal(afterLease.actions[0].tool, 'case_prepare');
  const afterEnv = transition(input({ stage: 'environment' }, [obs('environment', { result: { device_count: 2, conf: { device_ips: ['192.0.2.10', '192.0.2.11'] } } })]));
  assert.equal(afterEnv.state.stage, 'topology');
  const afterTopo = transition(input({ stage: 'topology' }, [obs('environment', { result: { device_count: 2, conf: { device_ips: ['192.0.2.10', '192.0.2.11'] } } }), obs('topology', { result: { devices: [] } })]));
  assert.equal(afterTopo.state.stage, 'device-map');
  assert.deepEqual(afterTopo.actions[0], { kind: 'tool.call', stepId: 'device-map', occurrence: 0, path: 'tools/environment.ts', export: 'environmentDevices', args: [{ environment: { device_count: 2, conf: { device_ips: ['192.0.2.10', '192.0.2.11'] } }, topology: { devices: [] } }] });
});

test('transition refuses on build mismatch and on lease refusal with the interpreted code', () => {
  const mismatch = transition(input({ stage: 'device-map' }, [
    obs('device-map', { result: { addresses: [['192.0.2.10'], ['192.0.2.11']], source: 'gateway.env_prepare.conf.device_ips' } }),
    obs('environment', { result: { ready: true, build_checked: true, checks: [{ check: 'device_build', ok: true, detail: 'device reports Synth_9_9_0_584, gateway bundle is Synth_9_9_0_585' }] } }),
  ]));
  assert.equal(mismatch.state.stage, 'failed');
  assert.equal(mismatch.actions[0].code, 'BUILD_MISMATCH');
  const refused = transition(input({ stage: 'lease' }, [obs('lease', { status: 'failed', error: { ok: false, stage: 'validation', reason: "expected exactly one 'IST_EXCEL_CONTRACT' identity marker, found 0" } })]));
  assert.equal(refused.actions[0].code, 'GATEWAY_REFUSED');
  assert.equal(refused.actions[0].facts.refusal.classification, 'legacy-contract-diagnostic');
});

test('transition submits the workbook via a controlled byte slot and waits on status', () => {
  const toSubmit = transition(input({ stage: 'verify' }, [obs('verify-workbook', {})]));
  assert.equal(toSubmit.state.stage, 'submit');
  const submit = toSubmit.actions.find((a) => a.stepId === 'submit');
  assert.equal(submit.kind, 'provider.call');
  assert.equal(submit.tool, 'case_submit');
  assert.deepEqual(submit.byteArgs, { workbook_b64: 'workbook' });
  assert.ok(!JSON.stringify(submit.args).includes('base64'), 'no inline base64 in args');
  const waiting = transition(input({ stage: 'wait' }, [obs('status', { result: { state: 'running', task_id: 'synthetic-remote' } })]));
  assert.equal(waiting.state.stage, 'wait');
  assert.equal(waiting.actions[0].kind, 'operation.wait');
  const terminal = transition(input({ stage: 'wait' }, [obs('status', { result: { state: 'done', task_id: 'synthetic-remote' } })]));
  assert.equal(terminal.state.stage, 'result');
  assert.equal(terminal.actions[0].tool, 'case_results');
  assert.equal(terminal.actions[0].args.task_id, 'synthetic-remote');
});

test('transition parses via the results tool and proposes delivery with unmapped awareness', () => {
  const toParse = transition(input({ stage: 'result' }, [obs('result', { result: { channel: 'ready', rc: 0, cases: [] } })]));
  assert.equal(toParse.state.stage, 'parse');
  const parse = toParse.actions[0];
  assert.equal(parse.path, 'tools/results.ts');
  assert.deepEqual(parse.byteSlots, ['workbook', 'results']);
  const parsed = transition(input({ stage: 'parse' }, [obs('parse-results', { result: { cases: [], unmapped: [] } })]));
  assert.equal(parsed.state.stage, 'afterResult');
  assert.equal(parsed.actions[0].event, 'afterResult');
  const delivered = transition(input({ stage: 'afterResult' }, [obs('after-result', {}), obs('parse-results', { result: { cases: [], unmapped: [] } })]));
  assert.equal(delivered.state.stage, 'done');
  assert.equal(delivered.actions[0].kind, 'delivery.propose');
  assert.equal(delivered.actions[0].status, 'succeeded');
  const partial = transition(input({ stage: 'afterResult' }, [obs('after-result', {}), obs('parse-results', { result: { cases: [], unmapped: [{ path: 'cases/x', reason: 'checkpoint_unmapped' }] } })]));
  assert.equal(partial.actions[0].status, 'partial');
});

test('every transition output passes the A2 validation', () => {
  const stages = ['lease', 'environment', 'topology', 'device-map', 'verify', 'submit', 'wait', 'result', 'parse', 'afterResult'];
  for (const stage of stages) {
    for (const observations of [[], [obs('lease', { result: {} })], [obs('parse-results', { result: { cases: [], unmapped: [] } })]]) {
      const output = transition(input({ stage }, observations));
      assert.deepEqual(validateTransitionOutput(output), [], `${stage} with ${observations.length} observations`);
    }
  }
});
