import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { emitTriage, gateTriage, priorityOf } from '../scripts/triage.mjs';

const policy = fileURLToPath(new URL('../references/sla-policy.json', import.meta.url));

test('priority stays a script and a credential in the original is filtered', () => {
  assert.equal(priorityOf({ severity: 2, tier: 'contract' }), 'P1');
  assert.equal(priorityOf({ severity: 4, tier: 'standard' }), 'P4');
  const folder = mkdtempSync(join(tmpdir(), 'triage-'));
  const tickets = {
    tickets: [
      { id: 't-1', subject: 'Checkout down', severity: 1, tier: 'standard', body: 'The page times out.' },
      { id: 't-2', subject: 'Reset', severity: 3, tier: 'standard', body: 'password=hunter2 please' },
    ],
  };
  writeFileSync(join(folder, 'return.json'), JSON.stringify({
    response: { result: { contentBase64: Buffer.from(JSON.stringify(tickets)).toString('base64') }, evidence: [{ evidenceId: 'evd_cccccccccccccccccccccccccccccccc' }] },
  }));
  const contract = join(folder, 'triage.contract.json');
  writeFileSync(contract, JSON.stringify({
    schema: 'enterprise/triage-contract/1',
    origin: 'model',
    source: { savedAs: 'return.json' },
    items: [
      { id: 't-1', intent: 'outage', quote: 'Checkout down' },
      { id: 't-2', intent: 'access', quote: 'password=hunter2 please' },
    ],
  }));
  const gate = gateTriage(folder, contract, policy);
  assert.equal(gate.ranked[0].queue, 'contract-desk');
  assert.equal(gate.ranked[0].responseMinutes, 15);
  assert.equal(gate.ranked[0].priority, 'P1');
  assert.equal(gate.ranked[1].credential, true);
  assert.equal(gate.ranked[1].queue, 'credential-hold');
  assert.equal(gate.ranked[1].quote.includes('hunter2'), false);
  const emitted = emitTriage(folder, contract);
  assert.equal(emitted.gaps[0].predicate, 'credential_filtered');
  writeFileSync(contract, JSON.stringify({
    schema: 'enterprise/triage-contract/1',
    origin: 'model',
    source: { savedAs: 'return.json' },
    items: [{ id: 't-1', intent: 'outage', quote: 'not in the ticket' }],
  }));
  assert.throws(() => gateTriage(folder, contract, policy), /quote_not_verbatim/);
});
