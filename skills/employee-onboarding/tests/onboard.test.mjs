import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { onboard } from '../scripts/onboard.mjs';

test('checklist gaps and non-starter roles are scripts, and the quote must be in the section', () => {
  const folder = mkdtempSync(join(tmpdir(), 'onboard-'));
  const section = { text: '**accounts**\nNew people get mail only.', evidenceId: 'evd_dddddddddddddddddddddddddddddddd' };
  const answer = { origin: 'model', question: 'What account?', answer: 'Mail only. [evd_dddddddddddddddddddddddddddddddd]', quote: 'New people get mail only.' };
  const result = onboard(folder, { completed: ['identity'] }, { requests: [{ person: 'ada', role: 'ledger-admin', system: 'ledger' }] }, section, answer);
  assert.equal(result.items.find((item) => item.item === 'equipment').status, 'missing');
  assert.equal(result.access[0].needsApproval, true);
  assert.match(readFileSync(join(folder, 'out', 'policy_answer.md'), 'utf8'), /New people get mail only/);
  assert.throws(() => onboard(folder, { completed: [] }, { requests: [] }, section, { ...answer, quote: 'not in the manual' }), /not in the saved section/);
});
