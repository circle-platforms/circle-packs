import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { emitOnboarding, gateOnboarding } from '../scripts/onboard.mjs';

const section = '**accounts**\nStarter role employee-mail may be granted with the account.\nRole ledger-admin shall not be granted without a separate approval.\n';
const chinese = readFileSync(fileURLToPath(new URL('./fixtures/policy.zh.txt', import.meta.url)), 'utf8');

test('a permit rule passes and a role the rules do not cover needs approval', () => {
  const folder = mkdtempSync(join(tmpdir(), 'onboard-'));
  writeFileSync(join(folder, 'return.json'), JSON.stringify({
    response: { result: { lines: section.split('\n').map((text, line) => ({ line: line + 1, text })) }, evidence: [{ evidenceId: 'evd_dddddddddddddddddddddddddddddddd' }] },
  }));
  const rules = join(folder, 'policy_rules.json');
  writeFileSync(rules, JSON.stringify({
    schema: 'enterprise/policy-rules/1',
    origin: 'model',
    source: { savedAs: 'return.json' },
    rules: [
      { id: 'r1', effect: 'permit', role: 'employee-mail', cue: 'may', quote: 'Starter role employee-mail may be granted with the account.' },
      { id: 'r2', effect: 'forbid', role: 'ledger-admin', cue: 'shall not', quote: 'Role ledger-admin shall not be granted without a separate approval.' },
    ],
  }));
  gateOnboarding(folder, rules);
  const result = emitOnboarding(folder, rules, { completed: ['identity'] }, { requests: [
    { person: 'ada', role: 'employee-mail', system: 'mail' },
    { person: 'ada', role: 'ledger-admin', system: 'ledger' },
    { person: 'ada', role: 'payroll-admin', system: 'payroll' },
  ] });
  assert.equal(result.items.find((item) => item.item === 'equipment').status, 'missing');
  assert.equal(result.access[0].needsApproval, false);
  assert.equal(result.access[1].decision, 'forbid');
  assert.equal(result.access[2].decision, 'uncovered');
  assert.match(readFileSync(join(folder, 'out', 'policy_answer.md'), 'utf8'), /employee-mail/);
  writeFileSync(rules, JSON.stringify({
    schema: 'enterprise/policy-rules/1',
    origin: 'model',
    source: { savedAs: 'return.json' },
    rules: [{ id: 'r1', effect: 'permit', role: 'employee-mail', cue: 'may', quote: 'not in the manual' }],
  }));
  assert.throws(() => gateOnboarding(folder, rules), /quote_not_verbatim/);
});

test('Chinese rules express a tenure floor and an admin downgrade', () => {
  const folder = mkdtempSync(join(tmpdir(), 'onboard-zh-'));
  writeFileSync(join(folder, 'policy.zh.txt'), chinese);
  const rules = join(folder, 'policy_rules.json');
  writeFileSync(rules, JSON.stringify({
    schema: 'enterprise/policy-rules/1',
    origin: 'model',
    source: { savedAs: 'policy.zh.txt' },
    rules: [
      { id: 'r1', effect: 'permit', role: '账本只读', cue: '可以', minTenureMonths: 6, quote: '入职满6个月的员工可以申请账本只读。' },
      { id: 'r2', effect: 'downgrade', role: '账本管理员', grant: '账本只读', cue: '降为', quote: '账本管理员应降为账本只读，不得直接开通管理员。' },
      { id: 'r3', effect: 'permit', role: '员工邮箱', cue: '可以', quote: '新员工可以开通员工邮箱。' },
    ],
  }));
  gateOnboarding(folder, rules);
  const result = emitOnboarding(folder, rules, { completed: ['identity'] }, { requests: [
    { person: 'ada', role: '账本只读', system: 'ledger', tenureMonths: 3 },
    { person: 'ada', role: '账本只读', system: 'ledger', tenureMonths: 6 },
    { person: 'ada', role: '账本管理员', system: 'ledger', tenureMonths: 24 },
  ] });
  assert.equal(result.access[0].decision, 'tenure_short');
  assert.equal(result.access[0].needsApproval, true);
  assert.equal(result.access[1].decision, 'permit');
  assert.equal(result.access[2].decision, 'downgrade');
  assert.equal(result.access[2].grant, '账本只读');
  const flipped = JSON.parse(readFileSync(rules, 'utf8'));
  delete flipped.rules[1].grant;
  flipped.rules[1].effect = 'permit';
  writeFileSync(rules, JSON.stringify(flipped));
  assert.throws(() => gateOnboarding(folder, rules), /polarity_mismatch/);
});
