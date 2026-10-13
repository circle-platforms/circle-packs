import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { gateBatch } from '../scripts/gate.mjs';
import { deriveFacts, parseIp, literalsOf, checkCase } from '../scripts/bed-facts.mjs';

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
  assert.equal(v.suggestion, '192.0.2.10');
  assert.deepEqual(clash.proposals, [{ autoid: '100000000000000001', rule: 'listener_not_on_device', from: '192.0.2.11', to: '192.0.2.10' }]);
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
