import { test } from 'node:test';
import assert from 'node:assert/strict';
import deviceCommandTree from '../hooks/device-command-tree.ts';
import hostDestructive from '../hooks/host-destructive.ts';
import workbookContract from '../hooks/workbook-contract.ts';

const input = (event, subject) => ({ event, binding: { method: 'm', resource: 'r', source: 's', inputRevision: 'inrev_x' }, subject });

test('device-command-tree passes a command in the tree and blocks one outside', () => {
  const tree = { heads: [{ command: 'sdns on', present: true }, { command: 'sdns off', present: true }] };
  assert.deepEqual(deviceCommandTree(input('verify.deviceCommand', { command: 'sdns on', tree })), { decision: 'pass' });
  const blocked = deviceCommandTree(input('verify.deviceCommand', { command: 'sdns fulldns on', tree }));
  assert.equal(blocked.decision, 'block');
  assert.equal(blocked.code, 'COMMAND_NOT_IN_TREE');
  assert.equal(blocked.facts.command, 'sdns fulldns on');
});

test('device-command-tree blocks an empty command', () => {
  assert.equal(deviceCommandTree(input('verify.deviceCommand', { command: '', tree: { heads: [] } })).code, 'COMMAND_NOT_IN_TREE');
});

test('host-destructive blocks self-destructive shell commands', () => {
  for (const cmd of ['rm -rf /', 'rm -rf /*', 'rm -rf /etc', 'rm -rf /home', 'dd if=/dev/zero of=/dev/sda', 'shutdown -h now', 'reboot', 'mkfs.ext4 /dev/sda1', 'passwd root', 'chmod -R 777 /'])
    assert.equal(hostDestructive(input('verify.hostCommand', { command: cmd })).code, 'DESTRUCTIVE_COMMAND', cmd);
});

test('host-destructive passes the normal test commands', () => {
  for (const cmd of ['dig @192.0.2.70 autotest.example', 'curl -s http://192.0.2.231/', 'ping -c 1 192.0.2.1', 'tc qdisc show', 'iptables -F', 'systemctl restart nginx', 'rm -rf /tmp/ist_staging_sdns', 'rm -f /home/test/old.log', 'killall -HUP dnsmasq'])
    assert.deepEqual(hostDestructive(input('verify.hostCommand', { command: cmd })), { decision: 'pass' }, cmd);
});

test('workbook-contract passes a client in the contract and blocks one outside', () => {
  const contract = { testEnvEnabled: ['routera', 'routerb'] };
  assert.deepEqual(workbookContract(input('verify.workbook', { client: 'routera', contract })), { decision: 'pass' });
  const blocked = workbookContract(input('verify.workbook', { client: 'console', contract }));
  assert.equal(blocked.decision, 'block');
  assert.equal(blocked.code, 'COMMAND_VALIDATION_FAILED');
  assert.equal(blocked.facts.client, 'console');
});
