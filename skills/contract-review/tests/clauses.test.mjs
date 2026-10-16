import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { emitReview } from '../scripts/emit.mjs';
import { gateClauses, headingsOf } from '../scripts/gate.mjs';

const policy = fileURLToPath(new URL('../references/risk-policy.json', import.meta.url));
const text = [
  '# Payment terms',
  'Payment is due within 30 days of invoice.',
  '# Termination',
  'Either party may end the contract on 30 days notice.',
  '# Liability',
  'Liability is capped at fees paid.',
  '',
].join('\n');

test('permit and forbid values are scored from the policy table and a missing heading is named', () => {
  assert.deepEqual(headingsOf(text).map((item) => item.heading), ['Payment terms', 'Termination', 'Liability']);
  const folder = mkdtempSync(join(tmpdir(), 'contract-'));
  writeFileSync(join(folder, 'return.json'), JSON.stringify({
    response: { result: { path: 'contracts/example.txt', contentBase64: Buffer.from(text).toString('base64') }, evidence: [{ evidenceId: 'evd_bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb' }] },
  }));
  const contract = join(folder, 'clauses.contract.json');
  writeFileSync(contract, JSON.stringify({
    schema: 'enterprise/clauses/1',
    origin: 'model',
    source: { savedAs: 'return.json' },
    clauses: [
      { id: 'c1', heading: 'Payment terms', effect: 'permit', value: '30 days', quote: 'Payment is due within 30 days of invoice.', source: { savedAs: 'return.json' } },
      { id: 'c2', heading: 'Liability', effect: 'forbid', value: 'capped', quote: 'Liability is capped at fees paid.', source: { savedAs: 'return.json' } },
    ],
  }));
  const gate = gateClauses(folder, contract, policy);
  assert.equal(gate.clauses[0].risk, 'low');
  assert.equal(gate.clauses[0].ruleId, 'payment-days');
  assert.equal(gate.clauses[1].risk, 'high');
  assert.deepEqual(gate.absent, ['Data protection']);
  assert.deepEqual(gate.unextracted, ['Termination']);
  const emitted = emitReview(folder, contract);
  assert.equal(emitted.claims.find((claim) => claim.predicate === 'missing_clause').origin, 'script');
  assert.match(readFileSync(join(folder, 'out', 'review_report.md'), 'utf8'), /Data protection: high/);
  writeFileSync(contract, JSON.stringify({
    schema: 'enterprise/clauses/1',
    origin: 'model',
    source: { savedAs: 'return.json' },
    clauses: [{ id: 'c1', heading: 'Payment terms', effect: 'permit', value: 'net', quote: 'not in the contract', source: { savedAs: 'return.json' } }],
  }));
  assert.throws(() => gateClauses(folder, contract, policy), /quote_not_verbatim/);
});
