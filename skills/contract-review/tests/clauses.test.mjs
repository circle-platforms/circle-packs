import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { emitReview } from '../scripts/emit.mjs';
import { gateClauses, headingsOf } from '../scripts/gate.mjs';

const policy = fileURLToPath(new URL('../references/risk-policy.json', import.meta.url));
const chinese = readFileSync(fileURLToPath(new URL('./fixtures/contract.zh.txt', import.meta.url)), 'utf8');
const text = [
  '# Payment terms',
  'Payment shall be due within 30 days of invoice.',
  '# Termination',
  'Either party may end the contract on 30 days notice.',
  '# Liability',
  'Liability shall not exceed fees paid.',
  '',
].join('\n');

function save(folder, name, body) {
  writeFileSync(join(folder, name), JSON.stringify({
    response: { result: { path: name, contentBase64: Buffer.from(body).toString('base64') }, evidence: [{ evidenceId: 'evd_bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb' }] },
  }));
}

test('permit and forbid values are scored from the policy table and a missing topic is named', () => {
  assert.deepEqual(headingsOf(text).map((item) => item.heading), ['Payment terms', 'Termination', 'Liability']);
  const folder = mkdtempSync(join(tmpdir(), 'contract-'));
  save(folder, 'return.json', text);
  const contract = join(folder, 'clauses.contract.json');
  const clauses = [
    { id: 'c1', heading: 'Payment terms', effect: 'permit', cue: 'shall', value: '30 days', quote: 'Payment shall be due within 30 days of invoice.', source: { savedAs: 'return.json' } },
    { id: 'c2', heading: 'Termination', effect: 'permit', cue: 'may', value: '30 days', quote: 'Either party may end the contract on 30 days notice.', source: { savedAs: 'return.json' } },
    { id: 'c3', heading: 'Liability', effect: 'forbid', cue: 'shall not', value: 'exceed', quote: 'Liability shall not exceed fees paid.', source: { savedAs: 'return.json' } },
  ];
  writeFileSync(contract, JSON.stringify({ schema: 'enterprise/clauses/1', origin: 'model', source: { savedAs: 'return.json' }, clauses }));
  const gate = gateClauses(folder, contract, policy);
  assert.equal(gate.clauses[0].risk, 'low');
  assert.equal(gate.clauses[0].ruleId, 'payment-standard');
  assert.equal(gate.clauses[2].risk, 'low');
  assert.deepEqual(gate.absent, ['data']);
  const emitted = emitReview(folder, contract, policy);
  assert.equal(emitted.claims.find((claim) => claim.predicate === 'missing_clause').origin, 'script');
  assert.match(readFileSync(join(folder, 'out', 'review_report.md'), 'utf8'), /data: high/);
  writeFileSync(contract, JSON.stringify({
    schema: 'enterprise/clauses/1',
    origin: 'model',
    source: { savedAs: 'return.json' },
    clauses: clauses.slice(0, 2),
  }));
  assert.throws(() => gateClauses(folder, contract, policy), /input_not_covered/);
  writeFileSync(contract, JSON.stringify({
    schema: 'enterprise/clauses/1',
    origin: 'model',
    source: { savedAs: 'return.json' },
    clauses: [{ id: 'c1', heading: 'Payment terms', effect: 'permit', cue: 'shall', value: 'net', quote: 'not in the contract', source: { savedAs: 'return.json' } }],
  }));
  assert.throws(() => gateClauses(folder, contract, policy), /quote_not_verbatim/);
});

test('Chinese articles, a short payment, a sharing ban, and a flipped effect', () => {
  assert.deepEqual(headingsOf(chinese).map((item) => item.heading), ['付款期限', '终止', '责任限制', '数据保护']);
  const folder = mkdtempSync(join(tmpdir(), 'contract-zh-'));
  writeFileSync(join(folder, 'contract.zh.txt'), chinese);
  const contract = join(folder, 'clauses.contract.json');
  const clauses = [
    { id: 'c1', heading: '付款期限', effect: 'permit', cue: '应', value: '10日', quote: '甲方应于收到发票后10日内付款。', source: { savedAs: 'contract.zh.txt' } },
    { id: 'c2', heading: '终止', effect: 'permit', cue: '可以', value: '30日', quote: '任何一方可以提前30日书面通知终止本合同。', source: { savedAs: 'contract.zh.txt' } },
    { id: 'c3', heading: '责任限制', effect: 'forbid', cue: '不得', value: '不得超出', quote: '赔偿责任不得超出已付费用。', source: { savedAs: 'contract.zh.txt' } },
    { id: 'c4', heading: '数据保护', effect: 'forbid', cue: '不', value: '不向关联方共享', quote: '乙方不向关联方共享甲方数据。', source: { savedAs: 'contract.zh.txt' } },
  ];
  writeFileSync(contract, JSON.stringify({ schema: 'enterprise/clauses/1', origin: 'model', source: { savedAs: 'contract.zh.txt' }, clauses }));
  const gate = gateClauses(folder, contract, policy);
  assert.equal(gate.clauses[0].risk, 'high');
  assert.equal(gate.clauses[0].ruleId, 'payment-short');
  assert.equal(gate.clauses[2].risk, 'low');
  assert.equal(gate.clauses[2].ruleId, 'liability-cap');
  assert.equal(gate.clauses[3].risk, 'low');
  assert.equal(gate.clauses[3].ruleId, 'data-forbid-share');
  assert.deepEqual(gate.absent, []);
  const flipped = clauses.map((clause) => clause.id === 'c4' ? { ...clause, effect: 'permit' } : clause);
  writeFileSync(contract, JSON.stringify({ schema: 'enterprise/clauses/1', origin: 'model', source: { savedAs: 'contract.zh.txt' }, clauses: flipped }));
  assert.throws(() => gateClauses(folder, contract, policy), /polarity_mismatch/);
});
