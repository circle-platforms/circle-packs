import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { buildTimeline, emitPostmortem, gateLabels } from '../scripts/timeline.mjs';

const text = [
  '2026-09-02T10:00:00Z inc-1 opened synthetic checkout failure',
  '2026-09-02T10:40:00Z inc-1 resolved',
  '2026-09-02T11:00:00Z inc-2 opened',
  '2026-09-02T11:20:00Z inc-2 resolved',
  '2026-09-02T12:00:00Z inc-3 acknowledged',
  'inc-4 resolved without a clock',
].join('\n');

test('MTTR uses the parsed lines and names missing fields', () => {
  const timeline = buildTimeline(text);
  assert.equal(timeline.mttrMinutes, 30);
  assert.deepEqual(timeline.missing.find((row) => row.incident === 'inc-3').missingFields, ['opened', 'resolved']);
  assert.deepEqual(timeline.unparsed[0].missingFields, ['timestamp']);
  const folder = mkdtempSync(join(tmpdir(), 'incident-'));
  writeFileSync(join(folder, 'return.json'), JSON.stringify({
    response: { result: { path: 'logs/example.log', contentBase64: Buffer.from(text).toString('base64') }, evidence: [{ evidenceId: 'evd_eeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee' }] },
  }));
  const labels = join(folder, 'labels.json');
  writeFileSync(labels, JSON.stringify({
    schema: 'enterprise/event-labels/1',
    origin: 'model',
    source: { savedAs: 'return.json' },
    labels: [
      { quote: '2026-09-02T10:00:00Z inc-1 opened synthetic checkout failure', event: 'mitigated', incident: 'inc-1' },
      { quote: 'inc-4 resolved without a clock', event: 'resolved', incident: 'inc-4' },
    ],
  }));
  const gate = gateLabels(folder, labels);
  assert.equal(gate.disagreements[0].parsed.event, 'opened');
  assert.equal(gate.timeline.mttrMinutes, 30);
  emitPostmortem(folder, labels);
  const report = readFileSync(join(folder, 'out', 'postmortem.md'), 'utf8');
  assert.match(report, /MTTR minutes: 30/);
  assert.match(report, /inc-3: opened, resolved/);
  assert.match(report, /unparsed: timestamp/);
  assert.equal(JSON.parse(readFileSync(join(folder, 'out', 'timeline.json'), 'utf8')).subject, 'incident-log:logs/example.log');
});
