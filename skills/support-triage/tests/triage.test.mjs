import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { emitTriage, gateTriage, priorityOf } from '../scripts/triage.mjs';

const policyPath = fileURLToPath(new URL('../references/sla-policy.json', import.meta.url));
const policy = JSON.parse(readFileSync(policyPath, 'utf8'));
const tickets = JSON.parse(readFileSync(fileURLToPath(new URL('./fixtures/tickets.zh.json', import.meta.url)), 'utf8'));

test('judged severity maps through the policy, and every ticket must be covered', () => {
  assert.equal(priorityOf('critical', policy), 'P1');
  assert.equal(priorityOf('low', policy), 'P4');
  const folder = mkdtempSync(join(tmpdir(), 'triage-'));
  writeFileSync(join(folder, 'return.json'), JSON.stringify({
    response: { result: { contentBase64: Buffer.from(JSON.stringify(tickets)).toString('base64') }, evidence: [{ evidenceId: 'evd_cccccccccccccccccccccccccccccccc' }] },
  }));
  const contract = join(folder, 'triage.contract.json');
  const items = [
    { id: 't-1', intent: 'outage', severity: 'critical', quote: '结算页打不开' },
    { id: 't-2', intent: 'account-takeover', severity: 'critical', quote: '有人在东京登录了我的账号' },
    { id: 't-3', intent: 'access', severity: 'medium', quote: 'password=hunter2 帮我改一下' },
  ];
  writeFileSync(contract, JSON.stringify({ schema: 'enterprise/triage-contract/1', origin: 'model', source: { savedAs: 'return.json' }, items }));
  const gate = gateTriage(folder, contract, policyPath);
  assert.equal(gate.ranked[0].queue, 'contract-desk');
  assert.equal(gate.ranked[0].responseMinutes, 15);
  assert.equal(gate.ranked[0].priority, 'P1');
  assert.equal(gate.ranked[1].queue, 'security-desk');
  assert.equal(gate.ranked[1].priority, 'P1');
  assert.equal(gate.ranked[1].responseMinutes, 15);
  assert.equal(gate.ranked[2].credential, true);
  assert.equal(gate.ranked[2].queue, 'credential-hold');
  assert.equal(gate.ranked[2].quote.includes('hunter2'), false);
  const emitted = emitTriage(folder, contract, policyPath);
  assert.equal(emitted.gaps[0].predicate, 'credential_filtered');
  writeFileSync(contract, JSON.stringify({
    schema: 'enterprise/triage-contract/1',
    origin: 'model',
    source: { savedAs: 'return.json' },
    items: items.slice(0, 2),
  }));
  assert.throws(() => gateTriage(folder, contract, policyPath), /input_not_covered: tickets: t-3/);
  writeFileSync(contract, JSON.stringify({
    schema: 'enterprise/triage-contract/1',
    origin: 'model',
    source: { savedAs: 'return.json' },
    items: [{ id: 't-1', intent: 'outage', severity: 'critical', quote: 'not in the ticket' }, items[1], items[2]],
  }));
  assert.throws(() => gateTriage(folder, contract, policyPath), /quote_not_verbatim/);
});
