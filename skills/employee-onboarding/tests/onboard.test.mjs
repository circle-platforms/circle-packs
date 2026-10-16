import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { compareExtracts, emitOnboarding, gateOnboarding } from '../scripts/onboard.mjs';
import { sha256 } from '../scripts/pointers.mjs';

const section = '**accounts**\nStarter role employee-mail may be granted with the account.\nRole ledger-admin is not granted without a separate approval.\n';
const chinese = readFileSync(fileURLToPath(new URL('./fixtures/policy.zh.txt', import.meta.url)), 'utf8');

function pin(bytes) {
  return JSON.stringify({ schema: 'circle-packs/policy-pin/1', sha256: sha256(bytes), approved: true });
}

function approve(folder, name, body) {
  const rules = join(folder, 'policy_rules.json');
  const file = join(folder, 'pin.json');
  const bytes = JSON.stringify(body);
  writeFileSync(rules, bytes);
  writeFileSync(file, pin(Buffer.from(bytes)));
  return { rules, file };
}

test('pinned rules permit a starter role and leave an uncovered role for a person', () => {
  const folder = mkdtempSync(join(tmpdir(), 'onboard-'));
  writeFileSync(join(folder, 'return.json'), JSON.stringify({
    response: { result: { lines: section.split('\n').map((text, line) => ({ line: line + 1, text })) }, evidence: [{ evidenceId: 'evd_dddddddddddddddddddddddddddddddd' }] },
  }));
  const text = section.split('\n').filter((line) => line.trim()).join('\n');
  const mail = 'Starter role employee-mail may be granted with the account.';
  const admin = 'Role ledger-admin is not granted without a separate approval.';
  const saved = JSON.parse(readFileSync(join(folder, 'return.json'), 'utf8'));
  const joined = saved.response.result.lines.map((line) => line.text).join('\n');
  const body = {
    schema: 'enterprise/policy-rules/2',
    origin: 'approved',
    source: { savedAs: 'return.json' },
    rules: [
      { id: 'r1', effect: 'permit', role: 'employee-mail', quote: mail, offset: joined.indexOf(mail) },
      { id: 'r2', effect: 'forbid', role: 'ledger-admin', quote: admin, offset: joined.indexOf(admin) },
    ],
  };
  const paths = approve(folder, 'return.json', body);
  gateOnboarding(folder, paths.rules, paths.file);
  const result = emitOnboarding(folder, paths.rules, { completed: ['identity'] }, { requests: [
    { person: 'ada', role: 'employee-mail', system: 'mail', startDate: '2026-09-01' },
    { person: 'ada', role: 'ledger-admin', system: 'ledger', startDate: '2026-09-01' },
    { person: 'ada', role: 'payroll-admin', system: 'payroll', startDate: '2026-09-01' },
  ] });
  assert.equal(result.items.find((item) => item.item === 'equipment').status, 'missing');
  assert.equal(result.access[0].needsApproval, false);
  assert.equal(result.access[0].grantDate, '2026-09-01');
  assert.equal(result.access[1].decision, 'forbid');
  assert.equal(result.access[2].decision, 'uncovered');
  body.rules[0].quote = 'not in the manual';
  body.rules[0].offset = 0;
  const broken = approve(folder, 'return.json', body);
  assert.throws(() => gateOnboarding(folder, broken.rules, broken.file), /quote_not_verbatim/);
  assert.equal(text.includes('employee-mail'), true);
});

test('Chinese rules keep days and months apart, name the approver, and refuse both effects on one quote', () => {
  const folder = mkdtempSync(join(tmpdir(), 'onboard-zh-'));
  writeFileSync(join(folder, 'policy.zh.txt'), chinese);
  const reader = (quote) => ({ quote, offset: chinese.indexOf(quote) });
  const readonly = reader('需入职满30天可以申请账本:只读，由直属经理批准。');
  const downgrade = reader('账本:管理员权限满90天后降为账本:只读，由安全官批准。');
  const mail = reader('新员工可以开通员工邮箱，由直属经理批准。');
  const body = {
    schema: 'enterprise/policy-rules/2',
    origin: 'approved',
    source: { savedAs: 'policy.zh.txt' },
    rules: [
      { id: 'r1', effect: 'permit', kind: 'obligation', role: '账本:只读', ...readonly, minTenure: { value: 30, unit: 'day' }, approver: '直属经理' },
      { id: 'r2', effect: 'downgrade', role: '账本:管理员', grant: '账本:只读', ...downgrade, after: { value: 90, unit: 'day' }, approver: '安全官' },
      { id: 'r3', effect: 'permit', role: '员工邮箱', ...mail, approver: '直属经理' },
    ],
  };
  const paths = approve(folder, 'policy.zh.txt', body);
  gateOnboarding(folder, paths.rules, paths.file);
  const result = emitOnboarding(folder, paths.rules, { completed: ['identity'] }, { requests: [
    { person: 'ada', role: '账本:只读', system: 'ledger', tenure: { value: 40, unit: 'day' }, startDate: '2026-09-01' },
    { person: 'ada', role: '账本:管理员', system: 'ledger', tenure: { value: 90, unit: 'day' }, startDate: '2026-09-01' },
    { person: 'ada', role: '账本:管理员', system: 'ledger', tenure: { value: 89, unit: 'day' }, startDate: '2026-09-01' },
  ] });
  assert.equal(result.access[0].decision, 'permit');
  assert.equal(result.access[0].grantDate, '2026-10-01');
  assert.equal(result.access[0].approver, '直属经理');
  assert.equal(result.access[1].decision, 'downgrade');
  assert.equal(result.access[1].grant, '账本:只读');
  assert.equal(result.access[1].grantDate, '2026-11-30');
  assert.equal(result.access[1].approver, '安全官');
  assert.equal(result.access[2].decision, 'not_yet');
  const months = structuredClone(body);
  months.rules[1].after = { value: 90, unit: 'month' };
  const badUnit = approve(folder, 'policy.zh.txt', months);
  assert.throws(() => gateOnboarding(folder, badUnit.rules, badUnit.file), /unit_mismatch/);
  const both = structuredClone(body);
  both.rules.push({ id: 'r4', effect: 'forbid', role: '账本:只读', ...readonly });
  const conflict = approve(folder, 'policy.zh.txt', both);
  assert.throws(() => gateOnboarding(folder, conflict.rules, conflict.file), /polarity_conflict/);
  const left = { schema: 'enterprise/policy-rules/2', origin: 'model', source: { savedAs: 'policy.zh.txt' }, rules: body.rules };
  const right = structuredClone(left);
  right.rules[0].effect = 'forbid';
  writeFileSync(join(folder, 'left.json'), JSON.stringify(left));
  writeFileSync(join(folder, 'right.json'), JSON.stringify(right));
  const compared = compareExtracts(join(folder, 'left.json'), join(folder, 'right.json'));
  assert.equal(compared.needsHuman, true);
  assert.equal(compared.disagreements[0].left, 'permit');
  assert.equal(compared.disagreements[0].right, 'forbid');
});
