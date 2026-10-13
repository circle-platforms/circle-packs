import { test } from 'node:test';
import assert from 'node:assert/strict';
import hostPolicy from '../hooks/host-policy.ts';

const BED = ['clientc', 'clientd', 'cliente', 'routera', 'routerb', 'server213', 'server231', 'server232'];
const input = (subject, declaration = { allowedTestHosts: BED, hostCommandPolicies: {} }) => ({
  event: 'verify.hostCommand',
  binding: { method: 'm', resource: { assetId: 'ast_x', version: '1', sha256: 'ab'.repeat(32), declaration } },
  subject,
});

test('a host in the closed set passes with the normal client commands', () => {
  for (const command of ['dig @192.0.2.70 autotest.com', 'curl -s http://192.0.2.70/', 'ping -c 1 192.0.2.1', 'tc qdisc show', 'iptables -L', 'systemctl status named'])
    assert.deepEqual(hostPolicy(input({ command, host: 'routera', method: 'cmd', kwargs: {} })), { decision: 'pass' }, command);
});

test('a host outside the closed set is blocked with the set size only', () => {
  const blocked = hostPolicy(input({ command: 'dig x', host: 'attacker', method: 'cmd', kwargs: {} }));
  assert.equal(blocked.decision, 'block');
  assert.equal(blocked.code, 'HOST_NOT_IN_BED');
  assert.equal(blocked.facts.host, 'attacker');
  assert.equal(blocked.facts.allowedCount, BED.length);
  assert.ok(!JSON.stringify(blocked).includes('clientc'), 'the closed set content never leaks');
});

test('a missing or empty closed set is HOST_SET_UNDECLARED', () => {
  for (const declaration of [null, {}, { allowedTestHosts: [] }, { allowedTestHosts: 'nope' }]) {
    const blocked = hostPolicy(input({ command: 'dig x', host: 'routera', method: 'cmd', kwargs: {} }, declaration));
    assert.equal(blocked.decision, 'block', String(JSON.stringify(declaration)));
    assert.equal(blocked.code, 'HOST_SET_UNDECLARED');
  }
});

test('template and substitution syntax is refused with the matching fragment', () => {
  for (const command of ['dig {{target}}', 'dig ${target}', 'echo $(whoami)', 'echo `whoami`', 'dig $TARGET'])
    assert.equal(hostPolicy(input({ command, host: 'routera', method: 'cmd', kwargs: {} })).code, 'COMMAND_NOT_LITERAL', command);
  const blocked = hostPolicy(input({ command: 'dig ${target}', host: 'routera', method: 'cmd', kwargs: {} }));
  assert.equal(blocked.facts.syntax, '${ }');
  assert.equal(blocked.facts.fragment, '${target}');
  // literal dollar signs that are not variable references stay passable
  assert.deepEqual(hostPolicy(input({ command: 'dig $ x', host: 'routera', method: 'cmd', kwargs: {} })), { decision: 'pass' });
});

test('a prefix policy narrows: allowed prefix passes, anything else is blocked', () => {
  const declaration = { allowedTestHosts: BED, hostCommandPolicies: { routera: { allowPrefixes: ['dig ', 'tc '] } } };
  assert.deepEqual(hostPolicy(input({ command: 'dig @192.0.2.70 x', host: 'routera', method: 'cmd', kwargs: {} }, declaration)), { decision: 'pass' });
  const blocked = hostPolicy(input({ command: 'curl -s http://192.0.2.70/', host: 'routera', method: 'cmd', kwargs: {} }, declaration));
  assert.equal(blocked.code, 'HOST_COMMAND_OUTSIDE_POLICY');
  assert.equal(blocked.facts.prefixCount, 2);
  // a host without a policy keeps the full literal range
  assert.deepEqual(hostPolicy(input({ command: 'curl -s http://192.0.2.70/', host: 'routerb', method: 'cmd', kwargs: {} }, declaration)), { decision: 'pass' });
});

test('a policy cannot admit a host outside the closed set', () => {
  const declaration = { allowedTestHosts: BED, hostCommandPolicies: { attacker: { allowPrefixes: ['dig '] } } };
  const blocked = hostPolicy(input({ command: 'dig x', host: 'attacker', method: 'cmd', kwargs: {} }, declaration));
  assert.equal(blocked.code, 'HOST_NOT_IN_BED');
});
