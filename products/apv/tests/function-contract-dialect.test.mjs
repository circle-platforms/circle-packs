import { test } from 'node:test';
import assert from 'node:assert/strict';
import { FunctionContract } from '../tools/function-contract.ts';
import { frameworkArguments, shellHost } from '../tools/dialect.ts';

const enc = (s) => new TextEncoder().encode(s);

const CONTRACT = JSON.stringify({
  schema: 'ist.excel.function-contract',
  complete: true,
  entries: [
    { e: 'test_env', f: 'routera', status: 'enabled' },
    { e: 'APV_0', f: 'reboot', status: 'disabled' },
  ],
  objects: [{ e: 'test_env', status: 'enabled' }],
});

test('function contract parses and answers status', () => {
  const c = new FunctionContract(enc(CONTRACT));
  assert.equal(c.status('test_env', 'routera'), 'enabled');
  assert.equal(c.status('APV_0', 'reboot'), 'disabled');
  assert.equal(c.status('test_env', 'console'), 'absent');
});

test('function contract rejects duplicates and malformed bytes', () => {
  assert.throws(() => new FunctionContract(enc('{"schema":"x"}')));
  const dup = JSON.stringify({ schema: 'ist.excel.function-contract', complete: true, entries: [{ e: 'a', f: 'b', status: 'enabled' }, { e: 'a', f: 'b', status: 'enabled' }] });
  assert.throws(() => new FunctionContract(enc(dup)));
});

test('frameworkArguments splits literal command and kwargs', () => {
  assert.deepEqual(frameworkArguments('dig @1.2.3.4 example.com'), { command: 'dig @1.2.3.4 example.com', kwargs: {} });
  assert.deepEqual(frameworkArguments('dig @1.2.3.4 x,timeout=30'), { command: 'dig @1.2.3.4 x', kwargs: { timeout: 30 } });
  assert.throws(() => frameworkArguments('a,b,c'));
  assert.throws(() => frameworkArguments('cmd,timeout=0'));
  assert.throws(() => frameworkArguments('cmd,timeout=9999'));
});

test('shellHost admits the contract shell clients and nothing else', () => {
  assert.ok(shellHost('routera'));
  assert.ok(!shellHost('console'));
  assert.ok(!shellHost('APV_0'));
});
