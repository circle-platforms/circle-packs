import { test } from 'node:test';
import assert from 'node:assert/strict';
import { extractClauses } from '../tools/contract-clauses.ts';
import { buildReportWorkbook, REPORT_FORMULAS } from '../tools/report-workbook.ts';
import { triageTickets } from '../tools/ticket-triage.ts';
import { checklistStatus, accessRequests } from '../tools/onboarding.ts';
import { buildTimeline, unixMs } from '../tools/incident-timeline.ts';
import accessApproval from '../hooks/access-approval.ts';

const encode = (text) => new TextEncoder().encode(text);

function unzipStored(bytes) {
  const files = new Map();
  let at = 0;
  while (at + 30 <= bytes.length && bytes[at] === 0x50 && bytes[at + 1] === 0x4b && bytes[at + 2] === 0x03 && bytes[at + 3] === 0x04) {
    const view = new DataView(bytes.buffer, bytes.byteOffset + at, 30);
    const method = view.getUint16(8, true);
    const size = view.getUint32(22, true);
    const nameLength = view.getUint16(26, true);
    const extra = view.getUint16(28, true);
    const name = new TextDecoder().decode(bytes.subarray(at + 30, at + 30 + nameLength));
    const start = at + 30 + nameLength + extra;
    assert.equal(method, 0, name);
    files.set(name, new TextDecoder().decode(bytes.subarray(start, start + size)));
    at = start + size;
  }
  return files;
}

test('contract clauses keep heading text and name the missing required headings', () => {
  const text = '# Parties\nExample Supplier.\n# Payment terms\nNet 30.\n# Termination\n30 days notice.\n';
  const found = extractClauses(text);
  assert.deepEqual(found.clauses.map((clause) => clause.heading), ['Parties', 'Payment terms', 'Termination']);
  assert.equal(found.clauses[1].text, 'Net 30.');
  assert.deepEqual(found.gaps, ['Liability', 'Data protection']);
});

test('the monthly workbook stores SUMIF formulas and the margin difference', () => {
  const body = encode(JSON.stringify({
    period: '2026-09',
    sources: [
      { name: 'sales', rows: [{ account: 'north', kind: 'revenue', amount: 120 }, { account: 'south', kind: 'revenue', amount: 30 }] },
      { name: 'expenses', rows: [{ account: 'north', kind: 'expense', amount: 45 }] },
    ],
  }));
  const { summary, xlsx } = buildReportWorkbook(body);
  assert.equal(summary.revenue, 150);
  assert.equal(summary.expense, 45);
  assert.equal(summary.margin, 105);
  assert.deepEqual(summary.formulas, REPORT_FORMULAS);
  const summarySheet = unzipStored(xlsx).get('xl/worksheets/sheet2.xml');
  assert.match(summarySheet, /SUMIF\(Lines!C:C,&quot;revenue&quot;,Lines!D:D\)/);
  assert.match(summarySheet, /<f>B1-B2<\/f><v>105<\/v>/);
  assert.match(unzipStored(xlsx).get('xl/worksheets/sheet1.xml'), /<v>120<\/v>/);
});

test('ticket priority is a script of severity and tier', () => {
  const rows = triageTickets([
    { id: 't-1', subject: 'Checkout down', severity: 1, tier: 'standard' },
    { id: 't-2', subject: 'Slow page', severity: 2, tier: 'contract' },
    { id: 't-3', subject: 'How do I export', severity: 4, tier: 'priority' },
    { id: 't-4', subject: 'Typo', severity: 4, tier: 'standard' },
  ]);
  assert.deepEqual(rows.map((row) => row.priority), ['P1', 'P1', 'P2', 'P4']);
  assert.equal(rows[0].origin, 'script');
});

test('onboarding marks missing checklist items and starter roles', () => {
  assert.deepEqual(checklistStatus(['identity', 'policies']), [
    { item: 'identity', status: 'done' },
    { item: 'equipment', status: 'missing' },
    { item: 'accounts', status: 'missing' },
    { item: 'policies', status: 'done' },
    { item: 'manager', status: 'missing' },
  ]);
  const requests = accessRequests([
    { person: 'ada', role: 'employee-mail', system: 'mail' },
    { person: 'ada', role: 'ledger-admin', system: 'ledger' },
  ]);
  assert.equal(requests[0].needsApproval, false);
  assert.equal(requests[1].needsApproval, true);
});

test('incident MTTR uses opened and resolved marks and skips an incomplete incident', () => {
  assert.equal(unixMs('2026-09-02T10:00:00Z'), Date.parse('2026-09-02T10:00:00Z'));
  const log = [
    '2026-09-02T10:00:00Z inc-1 opened synthetic checkout failure',
    '2026-09-02T10:40:00Z inc-1 resolved',
    '2026-09-02T11:00:00Z inc-2 opened',
    '2026-09-02T11:20:00Z inc-2 resolved',
    '2026-09-02T12:00:00Z inc-3 acknowledged',
  ].join('\n');
  const timeline = buildTimeline(log);
  assert.equal(timeline.events[0].incident, 'inc-1');
  assert.deepEqual(timeline.durations, [{ incident: 'inc-1', minutes: 40 }, { incident: 'inc-2', minutes: 20 }]);
  assert.equal(timeline.mttrMinutes, 30);
  assert.deepEqual(timeline.incomplete, ['inc-3']);
});

test('access approval blocks only an undeclared or unlisted grant', () => {
  const grant = (role, approvedRoles) => accessApproval({
    event: 'beforeDispatch',
    binding: { method: 'm', resource: { declaration: approvedRoles ? { approvedRoles } : {} }, source: 's', inputRevision: 'inrev_x' },
    subject: { input: { action: 'access-grant', role }, operationId: 'op_x' },
  });
  assert.equal(grant('ledger-admin').code, 'ACCESS_ROLES_UNDECLARED');
  assert.equal(grant('ledger-admin', ['employee-mail']).code, 'ACCESS_ROLE_UNAPPROVED');
  assert.equal(grant('employee-mail', ['employee-mail']).decision, 'pass');
  assert.deepEqual(accessApproval({
    event: 'beforeDispatch',
    binding: { resource: { declaration: {} } },
    subject: { input: { action: 'other' }, operationId: 'op_x' },
  }), { decision: 'pass' });
});
