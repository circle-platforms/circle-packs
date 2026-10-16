import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { emitPostmortem, gateLabels, parseTimestamp } from '../scripts/timeline.mjs';

const policyPath = fileURLToPath(new URL('../references/incident-policy.json', import.meta.url));
const pinPath = fileURLToPath(new URL('../references/incident-policy.pin.json', import.meta.url));
const chinese = readFileSync(fileURLToPath(new URL('./fixtures/log.zh.txt', import.meta.url)), 'utf8');
const zones = { JST: 540 };

function at(text, quote) {
  const offset = text.indexOf(quote);
  if (offset < 0) throw new Error(`missing ${quote}`);
  return offset;
}

function writePair(folder, labels, other = labels) {
  const body = (rows) => JSON.stringify({ schema: 'enterprise/event-labels/2', origin: 'model', source: { savedAs: 'log.zh.txt' }, labels: rows });
  const left = join(folder, 'left.json');
  const right = join(folder, 'right.json');
  writeFileSync(left, body(labels));
  writeFileSync(right, body(other));
  return { left, right };
}

function labelsFor(text) {
  const date = '2026-09-02';
  return [
    { quote: '[19:00 JST] 客服：用户无法登录', offset: at(text, '[19:00 JST] 客服：用户无法登录'), event: 'opened', incident: 'inc-1', at: '19:00 JST', dateFrom: { quote: date, offset: at(text, date) } },
    { quote: '2026-09-02T10:05:00Z 结算不可用', offset: at(text, '2026-09-02T10:05:00Z 结算不可用'), event: 'impact-start', incident: 'inc-1', at: '2026-09-02T10:05:00Z' },
    { quote: '2026-09-02T10:40:00Z 告警恢复', offset: at(text, '2026-09-02T10:40:00Z 告警恢复'), event: 'resolved', incident: 'inc-1', at: '2026-09-02T10:40:00Z' },
    { quote: '2026-09-02T10:50:00Z 客户恢复', offset: at(text, '2026-09-02T10:50:00Z 客户恢复'), event: 'impact-end', incident: 'inc-1', at: '2026-09-02T10:50:00Z' },
    { quote: '群里有人问了一句进度', offset: at(text, '群里有人问了一句进度'), event: 'other' },
  ];
}

test('a zoned clock parses, and a zone-less clock does not become UTC', () => {
  assert.equal(parseTimestamp('2026-09-02 19:00 JST', zones, null).ms, Date.parse('2026-09-02T10:00:00Z'));
  assert.equal(parseTimestamp('2026-09-02T10:40:00Z', zones, null).ms, Date.parse('2026-09-02T10:40:00Z'));
  assert.equal(parseTimestamp('19:00 JST', zones, { year: 2026, month: 9, day: 2 }).ms, Date.parse('2026-09-02T10:00:00Z'));
  assert.throws(() => parseTimestamp('2026-09-02T10:00:00', zones, null), /zone_missing/);
  assert.throws(() => parseTimestamp('19:00 JST', zones, null), /date_missing/);
});

test('alert duration and customer impact are separate, and a chat line needs no incident id', () => {
  const folder = mkdtempSync(join(tmpdir(), 'incident-'));
  writeFileSync(join(folder, 'log.zh.txt'), chinese);
  const rows = labelsFor(chinese);
  assert.equal(rows[0].quote.includes('inc-1'), false);
  const paths = writePair(folder, rows);
  const gate = gateLabels(folder, paths.left, paths.right, policyPath, pinPath);
  assert.equal(gate.ok, true);
  assert.equal(gate.needsHuman, false);
  assert.equal(gate.timeline.metrics.find((metric) => metric.id === 'alert').minutes, 40);
  assert.equal(gate.timeline.metrics.find((metric) => metric.id === 'customerImpact').minutes, 45);
  assert.equal(gate.timeline.events[0].assumption.date, '2026-09-02');
  assert.equal(gate.timeline.events[4].incident, null);
  emitPostmortem(folder, paths.left, paths.right, policyPath);
  const report = readFileSync(join(folder, 'out', 'postmortem.md'), 'utf8');
  assert.match(report, /alert minutes: 40/);
  assert.match(report, /customerImpact minutes: 45/);
  assert.match(report, /assumed date 2026-09-02/);
  const opened = rows[0];
  const duplicate = writePair(folder, [...rows, { ...opened, quote: opened.quote }]);
  assert.throws(() => gateLabels(folder, duplicate.left, duplicate.right, policyPath, pinPath), /duplicate_label/);
  const noDate = rows.map((row) => row.event === 'opened' ? { ...row, dateFrom: undefined } : row);
  const undated = writePair(folder, noDate);
  assert.throws(() => gateLabels(folder, undated.left, undated.right, policyPath, pinPath), /date_missing/);
  const zoneLess = '2026-09-02T10:00:00 无时区\n';
  writeFileSync(join(folder, 'log.zh.txt'), zoneLess);
  const bare = writePair(folder, [{ quote: '2026-09-02T10:00:00 无时区', offset: 0, event: 'opened', incident: 'inc-1', at: '2026-09-02T10:00:00' }]);
  assert.throws(() => gateLabels(folder, bare.left, bare.right, policyPath, pinPath), /zone_missing/);
});

test('a disagreed event is needs_human and does not invent a duration', () => {
  const folder = mkdtempSync(join(tmpdir(), 'incident-disagree-'));
  writeFileSync(join(folder, 'log.zh.txt'), chinese);
  const rows = labelsFor(chinese);
  const other = rows.map((row) => row.event === 'opened' ? { ...row, event: 'acknowledged' } : row);
  const paths = writePair(folder, rows, other);
  const gate = gateLabels(folder, paths.left, paths.right, policyPath, pinPath);
  assert.equal(gate.needsHuman, true);
  assert.equal(gate.timeline.metrics, null);
  emitPostmortem(folder, paths.left, paths.right, policyPath);
  const report = readFileSync(join(folder, 'out', 'postmortem.md'), 'utf8');
  assert.match(report, /Needs human/);
  assert.doesNotMatch(report, /alert minutes:/);
});
