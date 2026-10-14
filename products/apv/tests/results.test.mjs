import { test } from 'node:test';
import assert from 'node:assert/strict';
import { executionResults } from '../tools/results.ts';

// Synthetic book with one device step, one host step and two checkpoints; the log
// mimics the framework checkpoint format. Addresses are documentation-range only.
const book = (over = {}) => ({
  sha256: 'f'.repeat(64),
  cases: [{
    autoid: '100000000000000001',
    steps: [
      { row: 10, type: 2, description: 'cfg', object: 'APV_0', method: 'cmds_config', data: 'sdns on\nsdns listener 192.0.2.10', commands: ['sdns on', 'sdns listener 192.0.2.10'] },
      { row: 11, type: 3, description: 'dig', object: 'test_env', method: 'routera', data: 'dig @192.0.2.10 autotest.com', commands: [], call: { command: 'dig @192.0.2.10 autotest.com', kwargs: {} } },
      { row: 12, type: 3, description: 'cp', object: 'check_point', method: 'found', data: 'NOERROR', commands: [] },
      { row: 13, type: 3, description: 'cp2', object: 'check_point', method: 'found', data: 'SERVFAIL', commands: [] },
    ],
  }],
  ...over,
});
const log = (lines) => lines.join('\n');
const frame = (lines) => `2026-10-14 00:00:00 ${lines}`;

test('a full synthetic run maps checkpoints, device steps and host steps', () => {
  const raw = {
    channel: 'ready', rc: 0,
    cases: [{
      case_id: '100000000000000001', result: 'pass', log_stale: false,
      log: log([
        frame('192.0.2.10 - sends command in config: sdns on'),
        frame('192.0.2.10 - sends command in config: sdns listener 192.0.2.10'),
        frame('routera executes command: dig @192.0.2.10 autotest.com'),
        frame('#### Success Num 1: successed to find NOERROR in :'),
        frame('answer'),
        frame('#### Fail Num 2: fail to find SERVFAIL in :'),
      ]),
    }],
  };
  const attribution = { environment: { device_count: 1, conf: { device_ips: ['192.0.2.10'] } } };
  const parsed = executionResults(book(), raw, attribution);
  const item = parsed.cases[0];
  assert.equal(item.verdict, 'pass');
  assert.deepEqual(item.checkPoints.map((c) => c.status), ['passed', 'failed']);
  assert.equal(item.checkPoints[0].pattern, 'NOERROR');
  assert.equal(item.steps[0].status, 'observed'); // both device commands matched in order
  assert.equal(item.steps[1].status, 'observed'); // host dispatch proven
  assert.equal(parsed.deviceMap.source, 'gateway.env_prepare.conf.device_ips');
  assert.deepEqual(parsed.unmapped, []);
});

test('a missing device command leaves that step unknown and unmapped; the other device stays clean', () => {
  const raw = {
    channel: 'ready', rc: 0,
    cases: [{
      case_id: '100000000000000001', result: 'fail', log_stale: false,
      log: log([
        frame('192.0.2.10 - sends command in config: sdns on'),
        // second device command never appears
        frame('routera executes command: dig @192.0.2.10 autotest.com'),
        frame('#### Success Num 1: successed to find NOERROR in :'),
        frame('#### Fail Num 2: fail to find SERVFAIL in :'),
      ]),
    }],
  };
  const parsed = executionResults(book(), raw, { environment: { device_count: 1, conf: { device_ips: ['192.0.2.10'] } } });
  assert.equal(parsed.cases[0].steps[0].status, 'unknown');
  assert.deepEqual(parsed.cases[0].steps[0].missingCommandIndexes, [1]);
  assert.ok(parsed.unmapped.some((u) => u.reason === 'step_outcome_not_proven'));
});

test('missing device attribution unmaps every device line; shared addresses never map to two owners', () => {
  const raw = {
    channel: 'ready', rc: 0,
    cases: [{ case_id: '100000000000000001', result: 'fail', log_stale: false, log: log([frame('192.0.2.10 - sends command in config: sdns on')]) }],
  };
  const noMap = executionResults(book(), raw, {});
  assert.equal(noMap.deviceMap, null);
  assert.ok(noMap.unmapped.some((u) => u.reason === 'device_map_unavailable'));
  // two devices sharing one address: ownership is ambiguous, the line stays unmapped
  const shared = executionResults(book(), raw, { environment: { device_count: 2 }, topology: { topology: { devices: [
    { name: 'APV0', type: '负载均衡', ipv4: ['192.0.2.10/24'] },
    { name: 'APV1', type: '负载均衡', ipv4: ['192.0.2.10/24', '198.51.100.10/24'] }, // carries the shared address too
  ] } } });
  assert.equal(shared.cases[0].steps[0].status, 'unknown');
  assert.ok(shared.unmapped.some((u) => u.reason === 'device_map_unavailable'));
});

test('checkpoint count mismatch and stale logs leave the checkpoints unknown', () => {
  const raw = {
    channel: 'ready', rc: 0,
    cases: [{ case_id: '100000000000000001', result: 'fail', log_stale: true, log: '' }],
  };
  const parsed = executionResults(book(), raw, { environment: { device_count: 1, conf: { device_ips: ['192.0.2.10'] } } });
  assert.ok(parsed.unmapped.some((u) => u.reason === 'stale_log'));
  assert.equal(parsed.cases[0].checkPoints.every((c) => c.status === 'unknown'), true);
  // an unexpected case identity in the raw return is unmapped, not invented away
  const extra = executionResults(book(), { channel: 'ready', rc: 0, cases: [{ case_id: '999', result: 'pass', log_stale: false, log: '' }] }, {});
  assert.ok(extra.unmapped.some((u) => u.reason === 'unexpected_case_identity'));
});

test('runner_lost is an unknown channel; an empty task identity never becomes a case', () => {
  const parsed = executionResults(book(), { channel: 'runner_lost', rc: null, cases: [] }, {});
  assert.equal(parsed.executionStatus, 'unknown');
  assert.equal(parsed.cases.length, 1); // the book's case, verdict unknown
  assert.equal(parsed.cases[0].verdict, 'unknown');
});
