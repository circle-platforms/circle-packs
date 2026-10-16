import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { emitPostmortem, gateLabels, parseTimestamp } from '../scripts/timeline.mjs';

const policy = fileURLToPath(new URL('../references/incident-policy.json', import.meta.url));
const chinese = readFileSync(fileURLToPath(new URL('./fixtures/log.zh.txt', import.meta.url)), 'utf8');

test('JST and UTC labels are the clock, and a missing end fails the gate', () => {
  assert.equal(parseTimestamp('2026-09-02 19:00 JST', { JST: 540 }), Date.parse('2026-09-02T10:00:00Z'));
  assert.equal(parseTimestamp('2026-09-02T10:40:00Z', { JST: 540 }), Date.parse('2026-09-02T10:40:00Z'));
  assert.equal(parseTimestamp('2026-09-02T12:00:00+08:00', {}), Date.parse('2026-09-02T04:00:00Z'));
  const folder = mkdtempSync(join(tmpdir(), 'incident-'));
  writeFileSync(join(folder, 'return.json'), JSON.stringify({
    response: { result: { path: 'logs/example.log', contentBase64: Buffer.from(chinese).toString('base64') }, evidence: [{ evidenceId: 'evd_eeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee' }] },
  }));
  const labels = join(folder, 'labels.json');
  const rows = [
    { quote: '[2026-09-02 19:00 JST] inc-1 客服：用户无法登录', event: 'opened', incident: 'inc-1', at: '2026-09-02 19:00 JST' },
    { quote: '2026-09-02T10:40:00Z inc-1 resolved 已恢复', event: 'resolved', incident: 'inc-1', at: '2026-09-02T10:40:00Z' },
  ];
  writeFileSync(labels, JSON.stringify({ schema: 'enterprise/event-labels/1', origin: 'model', source: { savedAs: 'return.json' }, labels: rows }));
  const gate = gateLabels(folder, labels, policy);
  assert.equal(gate.ok, true);
  assert.equal(gate.timeline.mttrMinutes, 40);
  assert.equal(gate.timeline.events[0].event, 'opened');
  emitPostmortem(folder, labels, policy);
  assert.match(readFileSync(join(folder, 'out', 'postmortem.md'), 'utf8'), /MTTR minutes: 40/);
  const partial = `${chinese}\n2026-09-02T12:00:00+08:00 inc-2 acknowledged 处理中\n`;
  writeFileSync(join(folder, 'return.json'), JSON.stringify({
    response: { result: { path: 'logs/example.log', contentBase64: Buffer.from(partial).toString('base64') }, evidence: [{ evidenceId: 'evd_eeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee' }] },
  }));
  writeFileSync(labels, JSON.stringify({
    schema: 'enterprise/event-labels/1',
    origin: 'model',
    source: { savedAs: 'return.json' },
    labels: [...rows, { quote: '2026-09-02T12:00:00+08:00 inc-2 acknowledged 处理中', event: 'acknowledged', incident: 'inc-2', at: '2026-09-02T12:00:00+08:00' }],
  }));
  assert.throws(() => gateLabels(folder, labels, policy), /metrics_missing: inc-2 missing opened, resolved/);
  writeFileSync(labels, JSON.stringify({ schema: 'enterprise/event-labels/1', origin: 'model', source: { savedAs: 'return.json' }, labels: rows }));
  assert.throws(() => gateLabels(folder, labels, policy), /input_not_covered/);
});
