import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { emitOnboarding, gateOnboarding } from '../scripts/onboard.mjs';

const section = '**accounts**\nStarter role employee-mail is granted with the account.\nRole ledger-admin is forbid without a separate approval.\n';

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
      { id: 'r1', effect: 'permit', role: 'employee-mail', quote: 'Starter role employee-mail is granted with the account.' },
      { id: 'r2', effect: 'forbid', role: 'ledger-admin', quote: 'Role ledger-admin is forbid without a separate approval.' },
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
    rules: [{ id: 'r1', effect: 'permit', role: 'employee-mail', quote: 'not in the manual' }],
  }));
  assert.throws(() => gateOnboarding(folder, rules), /quote_not_verbatim/);
});
