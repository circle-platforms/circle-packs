import { test } from 'node:test';
import assert from 'node:assert/strict';
import { extractClauses, scoreClauses } from '../tools/contract-clauses.ts';
import { buildReportWorkbook, REPORT_FORMULAS, rowsFromCsv } from '../tools/report-workbook.ts';
import { routeTickets, triageTickets } from '../tools/ticket-triage.ts';
import { checklistStatus, accessRequests, evaluateAccess } from '../tools/onboarding.ts';
import { buildTimeline, timelineFromLabels, unixMs } from '../tools/incident-timeline.ts';
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
  const scored = scoreClauses(text, [{ id: 'c1', heading: 'Payment terms', effect: 'permit', value: 'Net 30', quote: 'Net 30.' }], {
    required: ['Payment terms', 'Termination', 'Liability', 'Data protection'],
    defaultRisk: 'review',
    rules: [{ id: 'payment-permit', heading: 'Payment terms', effect: 'permit', risk: 'low' }, { id: 'missing', heading: '*', effect: 'missing', risk: 'high' }],
  });
  assert.equal(scored.scored[0].risk, 'low');
  assert.equal(scored.scored[0].origin, 'script');
  const zh = '第1条 付款期限\n甲方应于收到发票后10日内付款。\n第4条 数据保护\n乙方不向关联方共享甲方数据。\n';
  assert.deepEqual(extractClauses(zh).clauses.map((clause) => clause.heading), ['付款期限', '数据保护']);
  const zhPolicy = {
    required: [{ id: 'payment', headings: ['付款期限'] }, { id: 'data', headings: ['数据保护'] }],
    defaultRisk: 'review',
    rules: [
      { id: 'payment-short', topic: 'payment', effect: 'permit', maxDays: 14, risk: 'high' },
      { id: 'data-forbid-share', topic: 'data', effect: 'forbid', valuePattern: '共享', risk: 'low' },
    ],
  };
  const zhScored = scoreClauses(zh, [
    { id: 'c1', heading: '付款期限', effect: 'permit', cue: '应', value: '10日', quote: '甲方应于收到发票后10日内付款。' },
    { id: 'c4', heading: '数据保护', effect: 'forbid', cue: '不', value: '不向关联方共享', quote: '乙方不向关联方共享甲方数据。' },
  ], zhPolicy);
  assert.equal(zhScored.scored[0].risk, 'high');
  assert.equal(zhScored.scored[1].risk, 'low');
  assert.throws(() => scoreClauses(zh, [
    { id: 'c4', heading: '数据保护', effect: 'permit', cue: '不', value: '不向关联方共享', quote: '乙方不向关联方共享甲方数据。' },
  ], zhPolicy), /polarity cue/);
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
  const csvRows = rowsFromCsv('sales', '账户,类型,金额\n华北,收入,120\n', { account: '账户', kind: '类型', amount: '金额' }, [{ kind: 'revenue', match: 'revenue|收入' }, { kind: 'expense', match: 'expense|支出' }]);
  assert.equal(csvRows[0].account, '华北');
  assert.equal(csvRows[0].kind, 'revenue');
  assert.throws(() => rowsFromCsv('sales', '账户,类型,金额\n华北,收入,120\n', { account: '账户', kind: '类型', amount: '120' }, [{ kind: 'revenue', match: '收入' }]), /Header 120/);
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
  const sla = {
    severities: { critical: { priority: 'P1', responseMinutes: 15 }, low: { priority: 'P4', responseMinutes: 1440 } },
    intents: { outage: { queue: 'contract-desk' }, 'account-takeover': { queue: 'security-desk' } },
    default: { queue: 'general', severity: 'low' },
    credential: { queue: 'credential-hold', responseMinutes: 60 },
  };
  const routed = routeTickets(
    [{ id: 't-1', subject: 'Checkout down', body: 'password=hunter2' }],
    [{ id: 't-1', intent: 'outage', severity: 'critical', quote: 'Checkout down' }],
    sla,
  );
  assert.equal(routed[0].queue, 'credential-hold');
  assert.equal(routed[0].priority, 'P1');
  const takeover = routeTickets(
    [{ id: 't-2', subject: '账号被盗', severity: 4, body: '有人在东京登录了我的账号' }],
    [{ id: 't-2', intent: 'account-takeover', severity: 'critical', quote: '有人在东京登录了我的账号' }],
    sla,
  );
  assert.equal(takeover[0].queue, 'security-desk');
  assert.equal(takeover[0].priority, 'P1');
  assert.equal(takeover[0].responseMinutes, 15);
  assert.throws(() => routeTickets(
    [{ id: 't-2', subject: '账号被盗', body: '有人在东京登录了我的账号' }, { id: 't-9', subject: '其他', body: '还有一张' }],
    [{ id: 't-2', intent: 'account-takeover', severity: 'critical', quote: '有人在东京登录了我的账号' }],
    sla,
  ), /not covered/);
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
  const graded = evaluateAccess(
    [
      { person: 'ada', role: '账本只读', system: 'ledger', tenureMonths: 3 },
      { person: 'ada', role: '账本管理员', system: 'ledger', tenureMonths: 24 },
    ],
    [
      { role: '账本只读', effect: 'permit', minTenureMonths: 6 },
      { role: '账本管理员', effect: 'downgrade', grant: '账本只读' },
    ],
  );
  assert.equal(graded[0].decision, 'tenure_short');
  assert.equal(graded[1].decision, 'downgrade');
  assert.equal(graded[1].grant, '账本只读');
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
  assert.deepEqual(timeline.missing.find((row) => row.incident === 'inc-3').missingFields, ['opened', 'resolved']);
  const withGap = buildTimeline(`${log}\ninc-4 resolved without a clock`);
  assert.deepEqual(withGap.unparsed[0].missingFields, ['timestamp']);
  assert.equal(withGap.mttrMinutes, 30);
  const chat = '[2026-09-02 19:00 JST] inc-1 客服：用户无法登录\n2026-09-02T10:40:00Z inc-1 resolved 已恢复\n';
  const labeled = timelineFromLabels(chat, [
    { quote: '[2026-09-02 19:00 JST] inc-1 客服：用户无法登录', incident: 'inc-1', event: 'opened', at: '2026-09-02 19:00 JST' },
    { quote: '2026-09-02T10:40:00Z inc-1 resolved 已恢复', incident: 'inc-1', event: 'resolved', at: '2026-09-02T10:40:00Z' },
  ], { startEvent: 'opened', endEvent: 'resolved', events: ['opened', 'acknowledged', 'mitigated', 'resolved'] });
  assert.equal(labeled.mttrMinutes, 40);
  assert.throws(() => timelineFromLabels(`${chat}2026-09-02T12:00:00+08:00 inc-2 acknowledged 处理中\n`, [
    { quote: '[2026-09-02 19:00 JST] inc-1 客服：用户无法登录', incident: 'inc-1', event: 'opened', at: '2026-09-02 19:00 JST' },
    { quote: '2026-09-02T10:40:00Z inc-1 resolved 已恢复', incident: 'inc-1', event: 'resolved', at: '2026-09-02T10:40:00Z' },
    { quote: '2026-09-02T12:00:00+08:00 inc-2 acknowledged 处理中', incident: 'inc-2', event: 'acknowledged', at: '2026-09-02T12:00:00+08:00' },
  ], { startEvent: 'opened', endEvent: 'resolved', events: ['opened', 'acknowledged', 'mitigated', 'resolved'] }), /missing opened, resolved/);
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
