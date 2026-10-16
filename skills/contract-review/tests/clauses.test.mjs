import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { emitReview } from '../scripts/emit.mjs';
import { gateClauses, headingsOf } from '../scripts/gate.mjs';
import { sha256 } from '../scripts/pointers.mjs';

const policyPath = fileURLToPath(new URL('../references/risk-policy.json', import.meta.url));
const pinPath = fileURLToPath(new URL('../references/risk-policy.pin.json', import.meta.url));
const chinese = readFileSync(fileURLToPath(new URL('./fixtures/contract.zh.txt', import.meta.url)), 'utf8');
const cueText = readFileSync(fileURLToPath(new URL('./fixtures/contract-cue.zh.txt', import.meta.url)), 'utf8');
const dayText = readFileSync(fileURLToPath(new URL('./fixtures/contract-days.zh.txt', import.meta.url)), 'utf8');
const english = [
  '# Payment terms',
  'Payment shall be due within 30 days of invoice.',
  '# Termination',
  'Either party may end the contract on 30 days notice.',
  '# Liability',
  'Liability shall not exceed fees paid.',
  '',
].join('\n');

function pinFor(bytes, approved = true) {
  return { schema: 'circle-packs/policy-pin/1', sha256: sha256(bytes), approved };
}

function writePair(folder, name, body, clauses, other) {
  const base = { schema: 'enterprise/clauses/2', origin: 'model', source: { savedAs: name }, clauses };
  const left = join(folder, 'left.json');
  const right = join(folder, 'right.json');
  writeFileSync(left, JSON.stringify(base));
  writeFileSync(right, JSON.stringify(other ? { ...base, clauses: other } : base));
  return { left, right };
}

function clause(text, fields) {
  const offset = text.indexOf(fields.quote);
  if (offset < 0) throw new Error(`missing quote ${fields.quote}`);
  return { offset, ...fields };
}

test('a one-line article keeps the marker, and agreed terms use the pinned day floor', () => {
  assert.deepEqual(headingsOf(chinese).map((item) => item.heading), ['第1条', '数据', '责任限制', '保密', 'SLA', '期限', '不可抗力']);
  const folder = mkdtempSync(join(tmpdir(), 'contract-zh-'));
  writeFileSync(join(folder, 'contract.zh.txt'), chinese);
  const clauses = [
    clause(chinese, { id: 'c1', heading: '第1条', kind: 'term', value: '三十日', quote: '甲方应于收到发票后三十日内付款。' }),
    clause(chinese, { id: 'c2', heading: '数据', kind: 'forbid', quote: '乙方不向关联方共享甲方数据。' }),
    clause(chinese, { id: 'c3', heading: '责任限制', kind: 'definition', quote: '赔偿责任以合同金额为限。' }),
    clause(chinese, { id: 'c4', heading: '保密', kind: 'obligation', quote: '双方应对本合同内容保密。' }),
    clause(chinese, { id: 'c6', heading: 'SLA', kind: 'definition', quote: '服务可用性为百分之九十九。' }),
    clause(chinese, { id: 'c7', heading: '期限', kind: 'term', value: '十二个月', quote: '本合同有效期为十二个月。' }),
    clause(chinese, { id: 'c8', heading: '不可抗力', kind: 'definition', quote: '因不可抗力免责。' }),
  ];
  const paths = writePair(folder, 'contract.zh.txt', chinese, clauses);
  const gate = gateClauses(folder, paths.left, paths.right, policyPath, pinPath);
  assert.equal(gate.clauses[0].risk, 'low');
  assert.equal(gate.clauses[0].ruleId, 'payment-days');
  assert.equal(gate.clauses[0].quantity.value, 30);
  assert.equal(gate.clauses[0].quantity.unit, 'day');
  assert.equal(gate.clauses[1].topic, 'data');
  assert.equal(gate.clauses[1].decision, 'unruled');
  assert.equal(gate.clauses[1].risk, null);
  assert.equal(gate.clauses[2].decision, 'unruled');
  assert.equal(gate.clauses[3].kind, 'obligation');
  assert.equal(gate.clauses[3].risk, null);
  assert.equal(gate.clauses[4].heading, 'SLA');
  assert.equal(gate.clauses[5].quantity.unit, 'month');
  assert.equal(gate.clauses[5].quantity.value, 12);
  assert.equal(gate.clauses[5].risk, null);
  assert.deepEqual(gate.unmatched, ['不可抗力']);
  assert.equal(gate.clauses[6].risk, null);
  const emitted = emitReview(folder, paths.left, paths.right, policyPath);
  assert.equal(emitted.claims.find((claim) => claim.predicate === 'unmatched_topic').value, null);
  assert.match(readFileSync(join(folder, 'out', 'review_report.md'), 'utf8'), /不可抗力: no default risk/);
});

test('十日 is under the pinned 30-day floor and 四十五日 meets it', () => {
  assert.deepEqual(headingsOf(dayText).map((item) => item.heading), ['第1条', '第2条']);
  const folder = mkdtempSync(join(tmpdir(), 'contract-days-'));
  writeFileSync(join(folder, 'days.zh.txt'), dayText);
  const clauses = [
    clause(dayText, { id: 'c1', heading: '第1条', kind: 'term', value: '十日', quote: '甲方应于收到发票后十日内付款。' }),
    clause(dayText, { id: 'c2', heading: '第2条', kind: 'term', value: '四十五日', quote: '甲方应于收到发票后四十五日内付款。' }),
  ];
  const paths = writePair(folder, 'days.zh.txt', dayText, clauses);
  const gate = gateClauses(folder, paths.left, paths.right, policyPath, pinPath);
  assert.equal(gate.clauses[0].risk, 'high');
  assert.equal(gate.clauses[0].quantity.value, 10);
  assert.equal(gate.clauses[1].risk, 'low');
  assert.equal(gate.clauses[1].quantity.value, 45);
  const stricter = JSON.parse(readFileSync(policyPath, 'utf8'));
  stricter.rules[0].minDays = 45;
  const policy = join(folder, 'policy.json');
  const pin = join(folder, 'pin.json');
  const bytes = JSON.stringify(stricter);
  writeFileSync(policy, bytes);
  writeFileSync(pin, JSON.stringify(pinFor(Buffer.from(bytes))));
  const thirty = '第1条 甲方应于收到发票后三十日内付款。\n';
  writeFileSync(join(folder, 'thirty.zh.txt'), thirty);
  const again = writePair(folder, 'thirty.zh.txt', thirty, [
    clause(thirty, { id: 'c1', heading: '第1条', kind: 'term', value: '三十日', quote: '甲方应于收到发票后三十日内付款。' }),
  ]);
  const raised = gateClauses(folder, again.left, again.right, policy, pin);
  assert.equal(raised.clauses[0].risk, 'high');
  assert.equal(raised.clauses[0].quantity.value, 30);
});

test('a cue is checked only for adjacency, and a kind disagreement is not resolved', () => {
  const folder = mkdtempSync(join(tmpdir(), 'contract-cue-'));
  writeFileSync(join(folder, 'cue.zh.txt'), cueText);
  const quote = '付款期限为三十日，存储地不限。';
  const base = clause(cueText, { id: 'c5', heading: '第5条', kind: 'term', value: '三十日', quote, cue: '不', predicate: '付款期限' });
  const paths = writePair(folder, 'cue.zh.txt', cueText, [base]);
  assert.throws(() => gateClauses(folder, paths.left, paths.right, policyPath, pinPath), /cue_not_adjacent/);
  const adjacent = { ...base, predicate: '限' };
  const agreed = writePair(folder, 'cue.zh.txt', cueText, [adjacent]);
  const kept = gateClauses(folder, agreed.left, agreed.right, policyPath, pinPath);
  assert.equal(kept.clauses[0].kind, 'term');
  assert.equal(kept.clauses[0].risk, 'low');
  const flipped = writePair(folder, 'cue.zh.txt', cueText, [adjacent], [{ ...adjacent, kind: 'forbid', value: undefined }]);
  const gate = gateClauses(folder, flipped.left, flipped.right, policyPath, pinPath);
  assert.equal(gate.needsHuman, true);
  assert.equal(gate.clauses[0].decision, 'needs_human');
  assert.equal(gate.clauses[0].risk, null);
  emitReview(folder, flipped.left, flipped.right, policyPath);
  const report = readFileSync(join(folder, 'out', 'review_report.md'), 'utf8');
  assert.match(report, /Needs human: term vs forbid/);
  assert.doesNotMatch(report, /Risk: (high|low)/);
});

test('the pin is the approved policy bytes, and a later policy edit is a policy change', () => {
  const folder = mkdtempSync(join(tmpdir(), 'contract-en-'));
  writeFileSync(join(folder, 'return.json'), JSON.stringify({
    response: { result: { path: 'contract.txt', contentBase64: Buffer.from(english).toString('base64') }, evidence: [{ evidenceId: 'evd_bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb' }] },
  }));
  const clauses = [
    clause(english, { id: 'c1', heading: 'Payment terms', kind: 'term', value: '30 days', quote: 'Payment shall be due within 30 days of invoice.' }),
    clause(english, { id: 'c2', heading: 'Termination', kind: 'permit', quote: 'Either party may end the contract on 30 days notice.' }),
    clause(english, { id: 'c3', heading: 'Liability', kind: 'forbid', quote: 'Liability shall not exceed fees paid.' }),
  ];
  const paths = writePair(folder, 'return.json', english, clauses);
  const gate = gateClauses(folder, paths.left, paths.right, policyPath, pinPath);
  assert.equal(gate.clauses[0].risk, 'low');
  assert.equal(gate.clauses[0].quantity.unit, 'day');
  assert.equal(gate.clauses[1].decision, 'unruled');
  assert.deepEqual(gate.unmatched, []);
  writeFileSync(paths.left, JSON.stringify({ schema: 'enterprise/clauses/2', origin: 'model', source: { savedAs: 'return.json' }, clauses: clauses.slice(0, 2) }));
  assert.throws(() => gateClauses(folder, paths.left, paths.right, policyPath, pinPath), /input_not_covered/);
  const badOffset = clauses.map((item) => item.id === 'c1' ? { ...item, offset: 0 } : item);
  const broken = writePair(folder, 'return.json', english, badOffset);
  assert.throws(() => gateClauses(folder, broken.left, broken.right, policyPath, pinPath), /quote_not_verbatim/);
  const policyBytes = readFileSync(policyPath);
  const unapproved = join(folder, 'unapproved.json');
  writeFileSync(unapproved, JSON.stringify(pinFor(policyBytes, false)));
  const restored = writePair(folder, 'return.json', english, clauses);
  assert.throws(() => gateClauses(folder, restored.left, restored.right, policyPath, unapproved), /policy_not_approved/);
  writeFileSync(unapproved, JSON.stringify(pinFor(Buffer.from('other'))));
  assert.throws(() => gateClauses(folder, restored.left, restored.right, policyPath, unapproved), /policy_pin_mismatch/);
  gateClauses(folder, restored.left, restored.right, policyPath, pinPath);
  writeFileSync(join(folder, 'edited-policy.json'), `${readFileSync(policyPath, 'utf8')}\n`);
  assert.throws(() => emitReview(folder, restored.left, restored.right, join(folder, 'edited-policy.json')), /policy_changed_after_gate/);
  writeFileSync(restored.left, `${readFileSync(restored.left, 'utf8')} `);
  assert.throws(() => emitReview(folder, restored.left, restored.right, policyPath), /contract_changed_after_gate/);
});
