import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { buildTimeline, writePostmortem } from '../scripts/timeline.mjs';

test('MTTR averages complete incidents and the narrative stays model text', () => {
  const text = '2026-09-02T10:00:00Z inc-1 opened synthetic checkout failure\n2026-09-02T10:40:00Z inc-1 resolved\n2026-09-02T11:00:00Z inc-2 opened\n2026-09-02T11:20:00Z inc-2 resolved\n';
  assert.equal(buildTimeline(text).mttrMinutes, 30);
  const folder = mkdtempSync(join(tmpdir(), 'incident-'));
  writePostmortem(folder, { text, path: 'logs/example.log', evidenceId: 'evd_eeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee' }, { origin: 'model', text: 'Checkout failed for forty minutes.' });
  const report = readFileSync(join(folder, 'out', 'postmortem.md'), 'utf8');
  assert.match(report, /MTTR minutes: 30/);
  assert.match(report, /Checkout failed for forty minutes/);
  assert.equal(JSON.parse(readFileSync(join(folder, 'out', 'timeline.json'), 'utf8')).subject, 'incident-log:logs/example.log');
});
