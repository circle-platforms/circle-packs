import { test } from 'node:test';
import assert from 'node:assert/strict';
import { normalizeIpv6, ipVersion, deviceAddress, environmentDevices, environmentBuild } from '../tools/environment.ts';
import { refusalFacts } from '../tools/refusal.ts';
import { validateTransitionOutput, finiteJsonOk, FLOW_VERSION, TRANSITION_SCHEMA, OUTCOME_CODES } from '../tools/execution-contracts.ts';
import { transition } from '../tools/execution-transition.ts';

// ---------- environment: normalization-equivalent IP handling (中11) ----------
test('ipVersion accepts what node:net accepts and refuses the rest; zones are tolerated then stripped', () => {
  assert.equal(ipVersion('192.0.2.1'), 4);
  assert.equal(ipVersion('203.0.113.213'), 4);
  assert.equal(ipVersion('2001:db8::10'), 6);
  assert.equal(ipVersion('::'), 6);
  assert.equal(ipVersion('2001:db8::192.0.2.1'), 6);
  assert.equal(ipVersion('2001:db8::1%eth0'), 6);
  assert.equal(ipVersion('256.1.1.1'), 0);
  assert.equal(ipVersion('1.2.3'), 0);
  assert.equal(ipVersion('192.0.2.1/24'), 0);
  assert.equal(ipVersion('2001::db8::1'), 0);
  assert.equal(ipVersion(':::1'), 0);
  assert.equal(ipVersion('not-an-ip'), 0);
});

test('normalizeIpv6 produces one canonical form per address regardless of spelling', () => {
  assert.equal(normalizeIpv6('2001:DB8::0010'), '2001:db8::10');
  assert.equal(normalizeIpv6('2001:0db8:0000:0000:0000:0000:0000:0010'), '2001:db8::10');
  assert.equal(normalizeIpv6('::ffff:192.0.2.1'), '::ffff:c000:201');
  assert.equal(normalizeIpv6('::ffff:c000:201'), '::ffff:c000:201');
  assert.equal(normalizeIpv6('::'), '::');
  assert.equal(normalizeIpv6('2001:db8::1%eth0'), '2001:db8::1');
  assert.equal(deviceAddress('[2001:DB8::10]'), '2001:db8::10');
  assert.equal(deviceAddress('2001:db8:0:0:0:0:0:10'), '2001:db8::10');
  assert.equal(deviceAddress('192.0.2.1'), '192.0.2.1');
  assert.equal(deviceAddress('hostname'), null);
});

// ---------- environment: mapping sources ----------
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

test('environmentDevices returns null on duplicates, count mismatch, shared address or out-of-range index', () => {
  assert.equal(environmentDevices({ environment: { device_count: 2, conf: { device_ips: ['192.0.2.10', '192.0.2.10'] } } }), null);
  assert.equal(environmentDevices({ environment: { device_count: 3, conf: { device_ips: ['192.0.2.10', '192.0.2.11'] } } }), null);
  assert.equal(environmentDevices({ environment: { device_count: 2 }, topology: { topology: { devices: [
    { name: 'APV0', type: '负载均衡', ipv4: ['192.0.2.10/24'] },
    { name: 'APV2', type: '负载均衡', ipv4: ['192.0.2.12/24'] }, // index 2 out of range
    { name: 'APV1', type: '负载均衡', ipv4: ['192.0.2.10/24'] }, // duplicate + shared address
  ] } } }), null);
  assert.equal(environmentDevices({}), null);
});

test('environmentBuild passes only on ready + build_checked + exact detail match, fake builds fail', () => {
  const ok = environmentBuild({ ready: true, build_checked: true, checks: [{ check: 'device_build', ok: true, detail: 'device reports Synth_9_9_0_585, gateway bundle is Synth_9_9_0_585' }] }, 'Synth_9_9_0_585');
  assert.equal(ok.passed, true);
  const fake = environmentBuild({ ready: true, build_checked: true, observedBuild: 'Synth_9_9_0_999' }, 'Synth_9_9_0_585');
  assert.equal(fake.passed, false);
  const notChecked = environmentBuild({ ready: true, build_checked: false }, 'Synth_9_9_0_585');
  assert.equal(notChecked.passed, false);
});

// ---------- refusal (低17 included: preDispatch needs the three proven facts) ----------
test('refusalFacts classifies legacy diagnostics and gateway-declared stages; unknown stays dispatch-unproven', () => {
  const legacy = refusalFacts({ ok: false, reason: "expected exactly one 'IST_EXCEL_CONTRACT' identity marker, found 0" });
  assert.equal(legacy.preDispatch, true);
  assert.equal(legacy.stage, 'validation');
  const declared = refusalFacts({ ok: false, stage: 'environment', code: 'BUILD_MISMATCH', reason: 'device reports other build' });
  assert.equal(declared.preDispatch, true);
  const dispatched = refusalFacts({ ok: false, stage: 'environment', task_id: 't', dispatched: true });
  assert.equal(dispatched.preDispatch, false);
  const bare = refusalFacts({ ok: false, reason: 'something else entirely' });
  assert.equal(bare.preDispatch, false);
  assert.equal(bare.classification, 'dispatch-unproven');
});

// ---------- contracts ----------
test('finiteJsonOk rejects the values A2 excludes; shared references are fine', () => {
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
  const shared = { node: { id: 1 } };
  assert.ok(finiteJsonOk({ a: shared, b: shared }));
});

test('validateTransitionOutput enforces registered codes, identities and the state budget', () => {
  const ok = { schema: TRANSITION_SCHEMA, state: { stage: 'environment' }, actions: [{ kind: 'operation.wait', stepId: 'wait-terminal', occurrence: 0, operationId: 'op-1' }] };
  assert.deepEqual(validateTransitionOutput(ok), []);
  assert.ok(!OUTCOME_CODES.includes('DEVICE_MAP_UNAVAILABLE'), 'unregistered code must not be in the table');
  assert.ok(OUTCOME_CODES.includes('HOOK_FAILED'));
  const badCode = { schema: TRANSITION_SCHEMA, state: {}, actions: [{ kind: 'outcome.error', stepId: 'x', occurrence: 0, code: 'DEVICE_MAP_UNAVAILABLE', facts: {} }] };
  assert.ok(validateTransitionOutput(badCode).some((p) => /unknown outcome code/.test(p)));
  const overState = { schema: TRANSITION_SCHEMA, state: { blob: 'x'.repeat(256 * 1024 + 1) }, actions: [] };
  assert.ok(validateTransitionOutput(overState).some((p) => /state over/.test(p)));
  assert.equal(FLOW_VERSION, 'apv-case-execute/2');
});

// ---------- transition, on hub-shaped inputs (高1) ----------
// The hub injects the whole FlowSubmission: currentInput.value IS the submission and
// the product payload sits in submission.value.
const submission = (value) => ({ deadlineMs: 3600000, flowId: 'apv-case-execute-v2', methodPin: { assetId: 'ast_method' }, resources: { gateway: { assetId: 'ast_gateway' } }, sources: {}, value, controlledBytes: [] });
const input = (state, observations, value = {}) => ({
  schema: TRANSITION_SCHEMA,
  binding: { taskId: 'synthetic-task' },
  currentInput: { value: submission({ build: 'Synth_9_9_0_585', deviceCommands: [{ command: 'sdns on' }], hostDispatches: [{ command: 'dig @192.0.2.10 x', host: 'routera' }], ...value }), sha256: '0'.repeat(64) },
  state,
  observations,
  controlledBytes: [],
});
const obs = (stepId, facts, operationId = `op-${stepId}`) => ({ operationId, reference: { kind: 'artifact', artifactId: `art_${stepId}`, sha256: '0'.repeat(64), size: 1 }, facts: { stepId, status: 'succeeded', ...facts } });

test('environment stage: one read-only env_prepare with device_build; conf mapping skips topology', () => {
  const first = transition(input({ stage: 'environment' }, []));
  assert.equal(first.state.stage, 'environment');
  assert.equal(first.actions[0].kind, 'provider.call');
  assert.equal(first.actions[0].resource, 'gateway'); // the bound alias, not an asset id
  assert.equal(first.actions[0].tool, 'env_prepare');
  assert.deepEqual(first.actions[0].args, { device_build: 'Synth_9_9_0_585' });
  const withConf = transition(input({ stage: 'environment' }, [obs('environment', { result: { device_count: 2, conf: { device_ips: ['192.0.2.10', '192.0.2.11'] } } })]));
  assert.equal(withConf.state.stage, 'device-map'); // no lease stage, no topology detour
  const withoutConf = transition(input({ stage: 'environment' }, [obs('environment', { result: { device_count: 2 } })]));
  assert.equal(withoutConf.state.stage, 'topology');
  assert.equal(withoutConf.actions[0].tool, 'bed_topology');
  assert.deepEqual(withoutConf.actions[0].args, { refresh: false });
  // a failed topology is not fatal: the device-map tool gets a null topology
  const topoFailed = transition(input({ stage: 'topology' }, [obs('environment', { result: { device_count: 2 } }), obs('topology', { status: 'failed' })]));
  assert.equal(topoFailed.state.stage, 'device-map');
});

test('device-map stage: build check, then per-command device and host verify hooks', () => {
  const env = obs('environment', { result: { device_count: 2, conf: { device_ips: ['192.0.2.10', '192.0.2.11'] }, ready: true, build_checked: true, checks: [{ check: 'device_build', ok: true, detail: 'device reports Synth_9_9_0_585, gateway bundle is Synth_9_9_0_585' }] } });
  const map = obs('device-map', { result: { addresses: [['192.0.2.10'], ['192.0.2.11']], source: 'gateway.env_prepare.conf.device_ips' } });
  const out = transition(input({ stage: 'device-map' }, [env, map]));
  assert.equal(out.state.stage, 'verify');
  const events = out.actions.map((a) => a.event);
  assert.equal(events.filter((e) => e === 'verify.deviceCommand').length, 1);
  assert.equal(events.filter((e) => e === 'verify.hostCommand').length, 1);
  assert.deepEqual(out.actions[0].subject, { command: 'sdns on', tree: { heads: [{ command: 'sdns on', present: true }] } });
  assert.deepEqual(out.actions[1].subject, { command: 'dig @192.0.2.10 x', host: 'routera', method: 'cmd', kwargs: {} });
  // build mismatch is terminal
  const badBuild = obs('environment', { result: { device_count: 2, conf: { device_ips: ['192.0.2.10', '192.0.2.11'] }, ready: true, build_checked: true, checks: [{ check: 'device_build', ok: true, detail: 'device reports Synth_9_9_0_584, gateway bundle is Synth_9_9_0_585' }] } });
  const mismatch = transition(input({ stage: 'device-map' }, [badBuild, map]));
  assert.equal(mismatch.actions[0].code, 'BUILD_MISMATCH');
});

test('verify passes to a single case_submit with xlsx_b64 from a byte slot; no beforeDispatch of our own', () => {
  const verifies = [obs('verify-device-0', {}), obs('verify-host-0', {}), obs('verify-workbook', {})];
  const out = transition(input({ stage: 'verify' }, verifies, { module: 'sdns' }));
  assert.equal(out.state.stage, 'submit');
  assert.equal(out.actions.length, 1);
  const submit = out.actions[0];
  assert.equal(submit.tool, 'case_submit');
  assert.equal(submit.args.module, 'sdns');
  assert.ok(!Object.hasOwn(submit.args, 'build'), 'build is not a submit argument');
  assert.ok(!Object.hasOwn(submit.args, 'deadline_ms'));
  assert.deepEqual(submit.byteArgs, { xlsx_b64: 'workbook' });
  assert.ok(!JSON.stringify(submit.args).includes('base64'));
  assert.ok(!out.actions.some((a) => a.event === 'beforeDispatch'), 'hub runs beforeDispatch at the write exit');
});

test('submit observes the hub-verified write chain; running means operation.wait, success goes straight to parse', () => {
  const running = transition(input({ stage: 'submit' }, [obs('submit', { status: 'running' })]));
  assert.equal(running.state.stage, 'wait');
  assert.equal(running.actions[0].kind, 'operation.wait');
  assert.equal(running.actions[0].operationId, 'op-submit'); // the very write operation
  const done = transition(input({ stage: 'submit' }, [obs('submit', { result: { channel: 'ready', rc: 0, cases: [] } })], { workbookBook: { cases: [] } }));
  assert.equal(done.state.stage, 'parse');
  const parse = done.actions[0];
  assert.equal(parse.path, 'tools/results.ts');
  assert.deepEqual(parse.byteSlots, ['workbook']); // only slots that exist
  assert.deepEqual(parse.args[0], { cases: [] }); // the results tool takes the book itself
});

test('parse and delivery: unmapped drives partial; a budget projection never reports succeeded', () => {
  const clean = transition(input({ stage: 'afterResult' }, [obs('after-result', {}), obs('parse-results', { result: { cases: [], unmapped: [] } })]));
  assert.equal(clean.actions[0].status, 'succeeded');
  const dirty = transition(input({ stage: 'afterResult' }, [obs('after-result', {}), obs('parse-results', { result: { cases: [], unmapped: [{ path: 'cases/x', reason: 'checkpoint_unmapped' }] } })]));
  assert.equal(dirty.actions[0].status, 'partial');
  const projected = transition(input({ stage: 'afterResult' }, [obs('after-result', {}), obs('parse-results', { result: { original: { reference: { kind: 'artifact', artifactId: 'a', sha256: '0'.repeat(64), size: 9 }, slot: 'hub.result.x' } } })]));
  assert.equal(projected.actions[0].status, 'partial'); // unknown unmapped ⇒ partial (中14)
});

test('refusals: lease unavailable on the write chain, gateway text from the observation original', () => {
  const refused = transition(input({ stage: 'submit' }, [obs('submit', { status: 'failed', error: { code: 'GATEWAY_REFUSED', message: 'refused', details: { gatewayRefusal: { schema: 'hub-provider-refusal/1', refusal: { ok: false, stage: 'validation', reason: "expected exactly one 'IST_EXCEL_CONTRACT' identity marker, found 0" } } } } })]));
  assert.equal(refused.actions[0].code, 'GATEWAY_REFUSED');
  assert.equal(refused.actions[0].facts.refusal.classification, 'legacy-contract-diagnostic');
});

test('every transition output passes the A2 validation', () => {
  const stages = ['environment', 'topology', 'device-map', 'verify', 'submit', 'wait', 'parse', 'afterResult'];
  for (const stage of stages) {
    for (const observations of [[], [obs('environment', { result: { device_count: 2 } })], [obs('parse-results', { result: { cases: [], unmapped: [] } })]]) {
      const output = transition(input({ stage }, observations));
      assert.deepEqual(validateTransitionOutput(output), [], `${stage} / ${observations.length}`);
    }
  }
});
