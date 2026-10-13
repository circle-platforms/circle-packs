import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { gateBatch } from '../scripts/gate.mjs';
import { deriveFacts, parseIp, literalsOf, checkCase, queryTargetOf } from '../scripts/bed-facts.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const BED_FACTS = join(HERE, 'fixtures', 'bed-facts.json');
const facts = () => deriveFacts(JSON.parse(readFileSync(BED_FACTS, 'utf8')));
const SOURCE_TEXT = '作者原文: 198.51.100.99 是亲笔地址';

// A minimal sound case on the synthetic bed: APV0 carries 192.0.2.10 (listener, paired with
// routerA/clientC on 192.0.2.0/24), server213 (203.0.113.213) is the backend.
const sound = (over = {}) => ({
  schema: 'apv.mechanical-case',
  autoid: '100000000000000001',
  description: { intent_verbatim: 't', group_path: ['a'] },
  build: 'Rel_SYN_9_9_0_42',
  init_commands: ['sdns on', 'sdns record ip "rec1" "autotest.com" 203.0.113.213'],
  blocks: [
    { kind: 'CONFIG', host: 'APV_0', cmds: ['sdns listener 192.0.2.10'], desc: 'cfg' },
    { kind: 'OBSERVE_ASSERT', host: 'APV_0', cmd: 'show sdns listener', asserts: [{ op: 'found', pattern: 'x', expectation_id: 'u1:100000000000000001:1:0' }] },
    { kind: 'CLIENT', client: 'routera', cmd: 'dig @192.0.2.10 autotest.com', asserts: [{ op: 'found', pattern: 'NOERROR', expectation_id: 'u1:100000000000000001:2:0' }] },
    { kind: 'CONFIG', host: 'APV_0', cmds: ['no sdns listener 192.0.2.10'], desc: 'cleanup' },
  ],
  expectation_binding: [],
  escape_hatches: [],
  command_receipts: [],
  ...over,
});

test('derived facts: listener list (★), pairing, blind addresses, triggers, servers, reachability', () => {
  const f = facts();
  assert.deepEqual([...f.listenerList].sort(), ['192.0.2.10', '192.0.2.11', '2001:db8::10']);
  assert.deepEqual(f.pairing.get('192.0.2.10').sort(), ['clientc', 'routera']);
  assert.deepEqual(f.triggerHosts.sort(), ['clientc', 'routera', 'routerb']);
  assert.deepEqual(f.serverAddresses, ['203.0.113.213']);
  assert.ok(f.reachable('192.0.2.99'), 'any address of a device subnet is reachable');
  assert.ok(f.reachable('203.0.113.99'), 'server subnets are reachable too');
  assert.ok(!f.reachable('192.0.3.1'));
  assert.ok(!f.reachable('203.0.114.7'));
  assert.equal(parseIp('2001:db8::10').text, '2001:db8::10');
  assert.deepEqual(literalsOf('dig @192.0.2.10 x,timeout=30'), ['192.0.2.10']);
});

test('a: an unreachable literal is address_not_on_bed; the author-verbatim one is environment_disclosure', () => {
  const f = facts();
  const invented = checkCase(sound({ init_commands: ['sdns on 203.0.114.7'] }), f, SOURCE_TEXT);
  assert.ok(invented.violations.some((v) => v.code === 'address_not_on_bed' && v.literal === '203.0.114.7'));
  // an unreachable literal the author wrote verbatim is environment_disclosure (rule f);
  // the same shape not in the author text stays address_not_on_bed (proved above)
  const authored = checkCase(sound({ init_commands: ['sdns on 203.0.114.7'] }), f, '作者亲笔 203.0.114.7');
  const disclosure = authored.violations.find((v) => v.literal === '203.0.114.7');
  assert.ok(disclosure && disclosure.code === 'environment_disclosure' && disclosure.category === 'environment');
  // a reachable literal in the author text raises neither code
  const fine = checkCase(sound({ init_commands: ['sdns on 198.51.100.99'] }), f, '作者亲笔 198.51.100.99');
  assert.ok(!fine.violations.some((v) => v.literal === '198.51.100.99'));
});

test('b: a listener address the device does not carry is blocked with a unique-subnet proposal', () => {
  const f = facts();
  const clash = checkCase(sound({ blocks: [
    { kind: 'CONFIG', host: 'APV_0', cmds: ['sdns listener 192.0.2.11'], desc: '' },
    { kind: 'CLIENT', client: 'routera', cmd: 'dig @192.0.2.10 x', asserts: [{ op: 'found', pattern: 'x', expectation_id: 'u:1' }] },
  ] }), f, '');
  const v = clash.violations.find((x) => x.code === 'listener_not_on_device');
  assert.ok(v && v.literal === '192.0.2.11' && v.device === 'APV_0');
  assert.equal(v.category, 'underdetermined'); // compile-time literal, not author-verbatim
  assert.ok(clash.proposals.some((p) => p.rule === 'listener_not_on_device' && p.from === '192.0.2.11' && p.to === '192.0.2.10'));
  assert.ok(!checkCase(sound(), f, '').violations.some((x) => x.code === 'listener_not_on_device'));
});

test('c: a dig target that is not the case listener and not on the star list is blocked', () => {
  const f = facts();
  const wrong = checkCase(sound({ blocks: [
    { kind: 'CONFIG', host: 'APV_0', cmds: ['sdns listener 192.0.2.10'], desc: '' },
    { kind: 'CLIENT', client: 'routera', cmd: 'dig @192.0.2.11 x', asserts: [{ op: 'found', pattern: 'x', expectation_id: 'u:1' }] },
  ] }), f, '');
  assert.ok(wrong.violations.some((v) => v.code === 'query_target_not_listener' && v.literal === '192.0.2.11'));
  assert.ok(!checkCase(sound(), f, '').violations.some((v) => v.code === 'query_target_not_listener'));
});

test('d: a trigger host outside the target subnet pairing is blocked with the paired hosts named', () => {
  const f = facts();
  const far = checkCase(sound({ blocks: [
    { kind: 'CONFIG', host: 'APV_0', cmds: ['sdns listener 192.0.2.10'], desc: '' },
    { kind: 'CLIENT', client: 'routerb', cmd: 'dig @192.0.2.10 x', asserts: [{ op: 'found', pattern: 'x', expectation_id: 'u:1' }] },
  ] }), f, '');
  const v = far.violations.find((x) => x.code === 'trigger_host_not_paired_with_target');
  assert.ok(v && v.host === 'routerb');
  assert.deepEqual(v.pairedHosts.sort(), ['clientc', 'routera']);
  assert.ok(!checkCase(sound(), f, '').violations.some((x) => x.code === 'trigger_host_not_paired_with_target'));
});

test('e: a backend address that is not a server address warns without blocking', () => {
  const f = facts();
  const warned = checkCase(sound({ init_commands: ['sdns on', 'sdns record ip "rec1" "autotest.com" 192.0.2.30'] }), f, '');
  const v = warned.violations.find((x) => x.code === 'backend_not_server');
  assert.ok(v && v.severity === 'warn' && v.literal === '192.0.2.30');
  assert.ok(!warned.violations.some((x) => x.severity === 'block'));
  assert.ok(!checkCase(sound(), f, '').violations.some((x) => x.code === 'backend_not_server'));
});

test('gate: missing or unreadable bed facts refuse the whole batch as bed_facts_unavailable', () => {
  const batch = mkdtempSync(join(tmpdir(), 'bed-'));
  try {
    mkdirSync(join(batch, 'cases'), { recursive: true });
    writeFileSync(join(batch, 'manifest.json'), JSON.stringify({ source: 'x.txt', source_sha256: 'a'.repeat(64), cases: [{ autoid: '100000000000000001' }] }));
    writeFileSync(join(batch, 'machine_mindmap.json'), JSON.stringify({ build: 'B', cases: [] }));
    for (const path of [null, join(batch, 'nope.json')]) {
      const report = gateBatch(batch, { bedFactsPath: path });
      assert.ok(Object.values(report.cases).every((r) => r.violations[0]?.code === 'bed_facts_unavailable'), String(path));
    }
  } finally { rmSync(batch, { recursive: true, force: true }); }
});

test('b split: an slb virtual VIP in a trigger-hosted subnet passes; one on a foreign address is blocked', () => {
  const f = facts();
  // 192.0.2.88 sits in 192.0.2.0/24 (trigger-hosted by routerA/clientC) and is carried by no device
  const vipOk = checkCase(sound({ blocks: [
    { kind: 'CONFIG', host: 'APV_0', cmds: ['slb virtual http "v1" 192.0.2.88 80 arp 0', 'sdns listener 192.0.2.10'], desc: '' },
    { kind: 'CLIENT', client: 'routera', cmd: 'dig @192.0.2.88 autotest.com', asserts: [{ op: 'found', pattern: 'x', expectation_id: 'u:1' }] },
  ] }), f, '');
  assert.ok(!vipOk.violations.some((x) => x.code === 'listener_not_on_device' && x.literal === '192.0.2.88'));
  assert.ok(!vipOk.violations.some((x) => x.code === 'query_target_not_listener' && x.literal === '192.0.2.88'));
  // a VIP that is another device's carried address is refused
  const vipBad = checkCase(sound({ blocks: [
    { kind: 'CONFIG', host: 'APV_0', cmds: ['slb virtual http "v1" 192.0.2.20 80 arp 0'], desc: '' },
  ] }), f, '');
  assert.ok(vipBad.violations.some((x) => x.code === 'listener_not_on_device' && x.literal === '192.0.2.20' && x.device === 'VIP'));
});

test('origins split three ways: verbatim disclosure, compile-time gap, neither blocks as error', () => {
  const f = facts();
  const verbatim = checkCase(sound({ init_commands: ['sdns on 203.0.114.7'] }), f, '作者亲笔 203.0.114.7');
  assert.equal(verbatim.violations.find((v) => v.literal === '203.0.114.7').category, 'environment');
  const introduced = checkCase(sound({ init_commands: ['sdns on 203.0.114.7'] }), f, '');
  assert.equal(introduced.violations.find((v) => v.literal === '203.0.114.7').category, 'underdetermined');
});

test('g: forward_only without an upstream in the case blocks as underdetermined; with a server upstream it passes', () => {
  const f = facts();
  const noUpstream = checkCase(sound({ blocks: [
    { kind: 'CONFIG', host: 'APV_0', cmds: ['sdns listener 192.0.2.10', 'sdns host name "s.test1" 60 forward_only'], desc: '' },
    { kind: 'CLIENT', client: 'routera', cmd: 'dig @192.0.2.10 s.test1', asserts: [{ op: 'found', pattern: 'x', expectation_id: 'u:1' }] },
  ] }), f, '');
  const g = noUpstream.violations.find((v) => v.code === 'feature_prerequisite_missing');
  assert.ok(g && g.category === 'underdetermined');
  const withUpstream = checkCase(sound({ blocks: [
    { kind: 'CONFIG', host: 'APV_0', cmds: ['sdns listener 192.0.2.10', 'sdns zone forward name "s.test1" "203.0.113.213%53" "default"'], desc: '' },
    { kind: 'CLIENT', client: 'routera', cmd: 'dig @192.0.2.10 s.test1', asserts: [{ op: 'found', pattern: 'x', expectation_id: 'u:1' }] },
  ] }), f, '');
  assert.ok(!withUpstream.violations.some((v) => v.code === 'feature_prerequisite_missing'));
});

test('a case needing many distinct listener placeholders gets no binding proposals', () => {
  const f = facts();
  const sixteen = checkCase(sound({ blocks: [
    { kind: 'CONFIG', host: 'APV_0', cmds: ['sdns listener 192.0.2.101', 'sdns listener 192.0.2.102'], desc: '' },
  ] }), f, '');
  assert.ok(sixteen.violations.filter((v) => v.code === 'listener_not_on_device').length >= 2);
  assert.deepEqual(sixteen.proposals, []);
});

test('curl URL and bare-host targets resolve to the host; slb virtual accepts a bare name', () => {
  assert.equal(queryTargetOf('dig @192.0.2.10 autotest.com'), '192.0.2.10');
  assert.equal(queryTargetOf('curl -s http://192.0.2.10/health'), '192.0.2.10');
  assert.equal(queryTargetOf('curl 192.0.2.10:8080/x'), '192.0.2.10');
  const f = facts();
  const bare = checkCase(sound({ blocks: [
    { kind: 'CONFIG', host: 'APV_0', cmds: ['slb virtual https v1 192.0.2.88 443 arp 0', 'sdns listener 192.0.2.10'], desc: '' },
    { kind: 'CLIENT', client: 'routera', cmd: 'curl -s http://192.0.2.88/health', asserts: [{ op: 'found', pattern: 'x', expectation_id: 'u:1' }] },
  ] }), f, '');
  assert.ok(!bare.violations.some((v) => v.code === 'listener_not_on_device' && v.literal === '192.0.2.88'));
  assert.ok(!bare.violations.some((v) => v.code === 'query_target_not_listener'));
});

test('gate: a confirmed binding turns the case gated and lands in applied_bindings', () => {
  // APV_0 listener on 192.0.2.11 (carried by APV1) with the dig target following: the
  // confirmed pair binds both to 192.0.2.10 and the case gates.
  const batch = mkdtempSync(join(tmpdir(), 'bind-'));
  try {
    mkdirSync(join(batch, 'cases'), { recursive: true });
    const item = sound({ blocks: [
      { kind: 'CONFIG', host: 'APV_0', cmds: ['sdns listener 192.0.2.11'], desc: '' },
      { kind: 'CLIENT', client: 'routera', cmd: 'dig @192.0.2.10 x', asserts: [{ op: 'found', pattern: 'x', expectation_id: 'u:1' }] },
    ] });
    // dig must target the placeholder so the pair moves together
    item.blocks[1].cmd = 'dig @192.0.2.11 x';
    writeFileSync(join(batch, 'cases', item.autoid + '.json'), JSON.stringify(item));
    writeFileSync(join(batch, 'manifest.json'), JSON.stringify({ source: 'x.txt', source_sha256: 'a'.repeat(64), cases: [{ autoid: item.autoid }] }));
    const entry = { autoid: item.autoid, bucket: 'exp_recipe', contract: { intent: 't', verification_method: 'v', expectation: 'e' }, expectations: [{ n: 1, text: 'e', origin: 'expectation:1' }], proposal: [] };
    writeFileSync(join(batch, 'machine_mindmap.json'), JSON.stringify({ build: 'B', cases: [entry] }));
    writeFileSync(join(batch, 'bindings.json'), JSON.stringify([
      { autoid: item.autoid, rule: 'listener_not_on_device', from: '192.0.2.11', to: '192.0.2.10' },
    ]));
    const report = gateBatch(batch, { bedFactsPath: BED_FACTS });
    // the bed-facts layer must be clean after the binding: no listener/target violation
    // survives (the fixture cuts corners elsewhere — no receipts, no contract — so the
    // case may still be rejected on those unrelated layers)
    const codes = report.cases[item.autoid].violations.map((v) => v.code);
    assert.ok(!codes.includes('listener_not_on_device'), codes.join(','));
    assert.ok(!codes.includes('query_target_not_listener'), codes.join(','));
    assert.ok(report.applied_bindings && report.applied_bindings.bindings.length === 1);
    assert.match(report.applied_bindings.sha256, /^[a-f0-9]{64}$/);
  } finally { rmSync(batch, { recursive: true, force: true }); }
});

test('gate: a binding whose from is not in the case refuses the whole batch', () => {
  const batch = mkdtempSync(join(tmpdir(), 'bind-'));
  try {
    mkdirSync(join(batch, 'cases'), { recursive: true });
    const item = sound();
    writeFileSync(join(batch, 'cases', item.autoid + '.json'), JSON.stringify(item));
    writeFileSync(join(batch, 'manifest.json'), JSON.stringify({ source: 'x.txt', source_sha256: 'a'.repeat(64), cases: [{ autoid: item.autoid }] }));
    const entry = { autoid: item.autoid, bucket: 'exp_recipe', contract: { intent: 't', verification_method: 'v', expectation: 'e' }, expectations: [{ n: 1, text: 'e', origin: 'expectation:1' }], proposal: [] };
    writeFileSync(join(batch, 'machine_mindmap.json'), JSON.stringify({ build: 'B', cases: [entry] }));
    writeFileSync(join(batch, 'bindings.json'), JSON.stringify([
      { autoid: item.autoid, rule: 'listener_not_on_device', from: '203.0.113.99', to: '203.0.113.213' },
    ]));
    const report = gateBatch(batch, { bedFactsPath: BED_FACTS });
    assert.ok(report.cases[item.autoid].violations[0]?.code === 'bed_facts_unavailable' || report.cases[item.autoid].violations.some((v) => /bindings.json invalid/.test(v.detail ?? '')) || /bindings.json invalid/.test(JSON.stringify(report)));
  } finally { rmSync(batch, { recursive: true, force: true }); }
});
