import { test } from 'node:test';
import assert from 'node:assert/strict';
import { agreeKind, extractClauses, parseQuantity, scoreTerm } from '../tools/contract-clauses.ts';
import { buildReportWorkbook, reconcileCsv, REPORT_FORMULAS, rowsFromCsv } from '../tools/report-workbook.ts';
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

test('contract headings stay short and a payment term uses the pinned day floor', () => {
  const text = '# Parties\nExample Supplier.\n# Payment terms\nNet 30.\n# Termination\n30 days notice.\n';
  const found = extractClauses(text);
  assert.deepEqual(found.clauses.map((clause) => clause.heading), ['Parties', 'Payment terms', 'Termination']);
  assert.equal(found.clauses[1].text, 'Net 30.');
  const zh = '第1条 甲方应于收到发票后三十日内付款。\n第2条 数据\n乙方不向关联方共享甲方数据。\n第8条 不可抗力\n因不可抗力免责。\n';
  assert.deepEqual(extractClauses(zh).clauses.map((clause) => clause.heading), ['第1条', '数据', '不可抗力']);
  const rule = { id: 'payment-days', topic: 'payment', kind: 'term', unit: 'day', minDays: 30, belowRisk: 'high', metRisk: 'low' };
  assert.equal(scoreTerm(parseQuantity('三十日'), rule).risk, 'low');
  assert.equal(scoreTerm(parseQuantity('十日'), rule).risk, 'high');
  assert.equal(scoreTerm(parseQuantity('四十五日'), rule).risk, 'low');
  assert.equal(scoreTerm(parseQuantity('十二个月'), rule).risk, null);
  assert.equal(scoreTerm(parseQuantity('三十日'), { ...rule, minDays: 45 }).risk, 'high');
  assert.deepEqual(agreeKind('term', 'forbid'), { decision: 'needs_human', kind: null });
  assert.equal(parseQuantity('90天').unit, 'day');
  assert.equal(parseQuantity('90天').value, 90);
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
  assert.throws(() => rowsFromCsv('sales', '账户,类型,金额\n华北,收入,\n', { account: '账户', kind: '类型', amount: '金额' }, [{ kind: 'revenue', match: '收入' }]), /empty_amount/);
  const ledger = reconcileCsv(
    '记账日期,部门,发生额,摘要\n2026-09-01,华北,16426400,收入\n2026-08-15,华南,98000,收入\n,合计,399,收入\n2026-09-02,华北,,收入\n2026-09-03,华北,-100,收入\n',
    { date: '记账日期', account: '部门', kind: '摘要', amount: '发生额' },
    [{ kind: 'revenue', match: '收入' }],
    '2026-09',
  );
  assert.equal(ledger.acceptedTotal, 16426400);
  assert.equal(ledger.reconcile.naivePositive, 16524799);
  assert.deepEqual(ledger.rejected.map((row) => row.reason), ['outside_period', 'bad_date', 'empty_amount', 'negative_amount']);
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
    severities: { critical: { priority: 'P1', responseMinutes: 15 }, high: { priority: 'P2', responseMinutes: 60 }, medium: { priority: 'P3', responseMinutes: 240 }, low: { priority: 'P4', responseMinutes: 1440 } },
    intents: { outage: { queue: 'contract-desk' }, 'account-takeover': { queue: 'security-desk' } },
    floors: { 'account-takeover': 'critical' },
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
    [{ id: 't-2', intent: 'account-takeover', severity: 'medium', quote: '有人在东京登录了我的账号' }],
    sla,
  );
  assert.equal(takeover[0].queue, 'security-desk');
  assert.equal(takeover[0].priority, 'P1');
  assert.equal(takeover[0].responseMinutes, 15);
  assert.equal(takeover[0].severityRaised, true);
  const unknown = routeTickets(
    [{ id: 't-9', subject: '天气', body: '明天会下雨吗' }],
    [{ id: 't-9', intent: 'weather', severity: 'low', quote: '明天会下雨吗' }],
    sla,
  );
  assert.equal(unknown[0].decision, 'needs_human');
  assert.equal(unknown[0].priority, null);
  assert.equal(unknown[0].responseMinutes, null);
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
      { person: 'ada', role: '账本:只读', system: 'ledger', tenure: { value: 40, unit: 'day' }, startDate: '2026-09-01' },
      { person: 'ada', role: '账本:管理员', system: 'ledger', tenure: { value: 90, unit: 'day' }, startDate: '2026-09-01' },
      { person: 'ada', role: '账本:管理员', system: 'ledger', tenure: { value: 89, unit: 'day' }, startDate: '2026-09-01' },
    ],
    [
      { role: '账本:只读', effect: 'permit', minTenure: { value: 30, unit: 'day' }, approver: '直属经理' },
      { role: '账本:管理员', effect: 'downgrade', grant: '账本:只读', after: { value: 90, unit: 'day' }, approver: '安全官' },
    ],
  );
  assert.equal(graded[0].decision, 'permit');
  assert.equal(graded[0].grantDate, '2026-10-01');
  assert.equal(graded[0].approver, '直属经理');
  assert.equal(graded[1].decision, 'downgrade');
  assert.equal(graded[1].grant, '账本:只读');
  assert.equal(graded[2].decision, 'not_yet');
  assert.throws(() => evaluateAccess(
    [{ person: 'ada', role: '账本:只读', system: 'ledger', tenure: { value: 3, unit: 'month' }, startDate: '2026-09-01' }],
    [{ role: '账本:只读', effect: 'permit', minTenure: { value: 90, unit: 'day' } }],
  ), /unit_mismatch/);
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
  const chat = '[2026-09-02 19:00 JST] 客服：用户无法登录\n2026-09-02T10:05:00Z 结算不可用\n2026-09-02T10:40:00Z 告警恢复\n2026-09-02T10:50:00Z 客户恢复\n群里有人问了一句进度\n';
  const policy = {
    events: ['opened', 'resolved', 'impact-start', 'impact-end', 'other'],
    metrics: [{ id: 'alert', start: 'opened', end: 'resolved' }, { id: 'customerImpact', start: 'impact-start', end: 'impact-end' }],
  };
  const labeled = timelineFromLabels(chat, [
    { quote: '[2026-09-02 19:00 JST] 客服：用户无法登录', incident: 'inc-1', event: 'opened', at: '2026-09-02 19:00 JST' },
    { quote: '2026-09-02T10:05:00Z 结算不可用', incident: 'inc-1', event: 'impact-start', at: '2026-09-02T10:05:00Z' },
    { quote: '2026-09-02T10:40:00Z 告警恢复', incident: 'inc-1', event: 'resolved', at: '2026-09-02T10:40:00Z' },
    { quote: '2026-09-02T10:50:00Z 客户恢复', incident: 'inc-1', event: 'impact-end', at: '2026-09-02T10:50:00Z' },
    { quote: '群里有人问了一句进度', event: 'other' },
  ], policy);
  assert.equal(labeled.metrics.find((metric) => metric.id === 'alert').minutes, 40);
  assert.equal(labeled.metrics.find((metric) => metric.id === 'customerImpact').minutes, 45);
  assert.throws(() => timelineFromLabels('2026-09-02T10:00:00 无时区\n', [
    { quote: '2026-09-02T10:00:00 无时区', incident: 'inc-1', event: 'opened', at: '2026-09-02T10:00:00' },
  ], policy), /zone_missing/);
  assert.throws(() => timelineFromLabels('2026-09-02T10:00:00Z 开了两次\n', [
    { quote: '2026-09-02T10:00:00Z 开了两次', incident: 'inc-1', event: 'opened', at: '2026-09-02T10:00:00Z' },
    { quote: '2026-09-02T10:00:00Z 开了两次', incident: 'inc-1', event: 'opened', at: '2026-09-02T10:00:00Z' },
  ], policy), /duplicate_label/);
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
