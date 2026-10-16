import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { emitTriage, gateTriage, priorityOf } from '../scripts/triage.mjs';

const policyPath = fileURLToPath(new URL('../references/sla-policy.json', import.meta.url));
const pinPath = fileURLToPath(new URL('../references/sla-policy.pin.json', import.meta.url));
const policy = JSON.parse(readFileSync(policyPath, 'utf8'));
const tickets = JSON.parse(readFileSync(fileURLToPath(new URL('./fixtures/tickets.zh.json', import.meta.url)), 'utf8'));
const raw = readFileSync(fileURLToPath(new URL('./fixtures/ticket-text.zh.json', import.meta.url)), 'utf8');

function blob(ticket) {
  return `${ticket.subject}\n${ticket.body ?? ''}`;
}

function item(ticket, fields) {
  const text = blob(ticket);
  return { id: ticket.id, offset: text.indexOf(fields.quote), ...fields };
}

function writePair(folder, name, items, other = items) {
  const body = (rows) => JSON.stringify({ schema: 'enterprise/triage-contract/2', origin: 'model', source: { savedAs: name }, items: rows });
  const left = join(folder, 'left.json');
  const right = join(folder, 'right.json');
  writeFileSync(left, body(items));
  writeFileSync(right, body(other));
  return { left, right };
}

test('a security floor raises an agreed severity, and a disagreement is not given a priority', () => {
  assert.equal(priorityOf('critical', policy), 'P1');
  const folder = mkdtempSync(join(tmpdir(), 'triage-'));
  writeFileSync(join(folder, 'return.json'), JSON.stringify({
    response: { result: { contentBase64: Buffer.from(JSON.stringify(tickets)).toString('base64') }, evidence: [{ evidenceId: 'evd_cccccccccccccccccccccccccccccccc' }] },
  }));
  const items = [
    item(tickets.tickets[0], { intent: 'outage', severity: 'critical', quote: '结算页打不开' }),
    item(tickets.tickets[1], { intent: 'account-takeover', severity: 'medium', quote: '有人在东京登录了我的账号' }),
    item(tickets.tickets[2], { intent: 'access', severity: 'medium', quote: 'password=hunter2 帮我改一下' }),
  ];
  const paths = writePair(folder, 'return.json', items);
  const gate = gateTriage(folder, paths.left, paths.right, policyPath, pinPath);
  assert.equal(gate.ranked[0].queue, 'contract-desk');
  assert.equal(gate.ranked[0].responseMinutes, 15);
  assert.equal(gate.ranked[0].priority, 'P1');
  assert.equal(gate.ranked[1].queue, 'security-desk');
  assert.equal(gate.ranked[1].priority, 'P1');
  assert.equal(gate.ranked[1].responseMinutes, 15);
  assert.equal(gate.ranked[1].severityRaised, true);
  assert.equal(gate.ranked[1].judgedSeverity, 'medium');
  assert.equal(gate.ranked[1].floorApplied, 'critical');
  assert.equal(gate.ranked[2].credential, true);
  assert.equal(gate.ranked[2].queue, 'credential-hold');
  assert.equal(gate.ranked[2].quote.includes('hunter2'), false);
  const emitted = emitTriage(folder, paths.left, paths.right, policyPath);
  assert.equal(emitted.gaps[0].predicate, 'credential_filtered');
  const partial = writePair(folder, 'return.json', items.slice(0, 2));
  assert.throws(() => gateTriage(folder, partial.left, partial.right, policyPath, pinPath), /input_not_covered: tickets: t-3/);
  const moved = items.map((row) => row.id === 't-1' ? { ...row, offset: 0, quote: 'not in the ticket' } : row);
  const broken = writePair(folder, 'return.json', moved);
  assert.throws(() => gateTriage(folder, broken.left, broken.right, policyPath, pinPath), /quote_not_verbatim/);
  const disagreed = writePair(folder, 'return.json', items, items.map((row) => row.id === 't-2' ? { ...row, severity: 'critical' } : row));
  const human = gateTriage(folder, disagreed.left, disagreed.right, policyPath, pinPath);
  assert.equal(human.ranked[1].decision, 'needs_human');
  assert.equal(human.ranked[1].priority, null);
  assert.equal(human.ranked[1].severityRaised, false);
  emitTriage(folder, disagreed.left, disagreed.right, policyPath);
  const report = readFileSync(join(folder, 'out', 'replies.md'), 'utf8');
  assert.match(report, /## t-2\n\nNeeds human/);
  assert.doesNotMatch(report, /t-2[\s\S]*P4/);
  assert.doesNotMatch(report, /t-2[\s\S]*1440/);
});

test('an unknown intent is needs_human and a raw text ticket is accepted', () => {
  const folder = mkdtempSync(join(tmpdir(), 'triage-unknown-'));
  const ticketsFile = { tickets: [{ id: 't-9', subject: '天气', body: '明天会下雨吗' }] };
  writeFileSync(join(folder, 'return.json'), JSON.stringify(ticketsFile));
  const text = '天气\n明天会下雨吗';
  const items = [{ id: 't-9', intent: 'weather', severity: 'low', quote: '明天会下雨吗', offset: text.indexOf('明天会下雨吗') }];
  const paths = writePair(folder, 'return.json', items);
  const gate = gateTriage(folder, paths.left, paths.right, policyPath, pinPath);
  assert.equal(gate.ranked[0].decision, 'needs_human');
  assert.equal(gate.ranked[0].priority, null);
  assert.equal(gate.ranked[0].responseMinutes, null);
  emitTriage(folder, paths.left, paths.right, policyPath);
  const report = readFileSync(join(folder, 'out', 'replies.md'), 'utf8');
  assert.match(report, /Needs human/);
  assert.doesNotMatch(report, /P4/);
  assert.doesNotMatch(report, /1440/);
  writeFileSync(join(folder, 'raw.json'), raw);
  const rawText = JSON.parse(raw).text;
  const rawItems = [{ id: 'text', intent: 'outage', severity: 'high', quote: '结算页打不开', offset: rawText.indexOf('结算页打不开') }];
  const rawPaths = writePair(folder, 'raw.json', rawItems);
  const accepted = gateTriage(folder, rawPaths.left, rawPaths.right, policyPath, pinPath);
  assert.equal(accepted.ranked[0].id, 'text');
  assert.equal(accepted.ranked[0].queue, 'contract-desk');
  assert.equal(accepted.ranked[0].priority, 'P2');
});
