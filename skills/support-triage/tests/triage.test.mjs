import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { priorityOf, triage } from '../scripts/triage.mjs';

test('priority is scripted and a reply that does not quote the section is a gap', () => {
  assert.equal(priorityOf({ severity: 2, tier: 'contract' }), 'P1');
  assert.equal(priorityOf({ severity: 4, tier: 'standard' }), 'P4');
  const folder = mkdtempSync(join(tmpdir(), 'triage-'));
  const tickets = { result: { contentBase64: Buffer.from(JSON.stringify({ tickets: [{ id: 't-1', subject: 'Export', severity: 4, tier: 'standard' }] })).toString('base64') } };
  const section = { result: { lines: [{ line: 1, text: '**export**' }, { line: 2, text: 'Use the export button.' }] }, evidenceId: 'evd_cccccccccccccccccccccccccccccccc' };
  const replies = { replies: [
    { ticketId: 't-1', body: 'Use the export button.', origin: 'model', quote: 'Use the export button.', evidenceId: 'evd_cccccccccccccccccccccccccccccccc' },
    { ticketId: 't-2', body: 'I think it is fine.', origin: 'model', quote: '', evidenceId: '' },
  ] };
  const result = triage(folder, tickets, section, replies);
  assert.equal(result.ranked[0].priority, 'P4');
  assert.equal(result.gaps.length, 1);
  assert.match(readFileSync(join(folder, 'out', 'replies.md'), 'utf8'), /Quoted \(script-checked\)/);
});
