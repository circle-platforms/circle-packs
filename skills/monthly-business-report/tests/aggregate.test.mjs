import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { emitReport, FORMULAS, gateReport } from '../scripts/aggregate.mjs';
import { sha256 } from '../scripts/pointers.mjs';

const sample = readFileSync(fileURLToPath(new URL('../references/metrics.sample.yaml', import.meta.url)), 'utf8');
const pinPath = fileURLToPath(new URL('../references/metrics.sample.pin.json', import.meta.url));
const sales = readFileSync(fileURLToPath(new URL('./fixtures/sales.zh.csv', import.meta.url)), 'utf8');
const expenses = readFileSync(fileURLToPath(new URL('./fixtures/expenses.zh.csv', import.meta.url)), 'utf8');
const ledger = readFileSync(fileURLToPath(new URL('./fixtures/ledger.zh.csv', import.meta.url)), 'utf8');

function pin(bytes) {
  return JSON.stringify({ schema: 'circle-packs/policy-pin/1', sha256: sha256(bytes), approved: true });
}

function writePair(folder, sources, other = sources) {
  const body = (rows) => JSON.stringify({ schema: 'enterprise/header-map/1', origin: 'model', sources: rows });
  const left = join(folder, 'left.json');
  const right = join(folder, 'right.json');
  writeFileSync(left, body(sources));
  writeFileSync(right, body(other));
  return { left, right };
}

test('raw CSV is aggregated from an agreed header map, and a transcribed cell is refused', () => {
  const folder = mkdtempSync(join(tmpdir(), 'report-'));
  const metrics = join(folder, 'metrics.yaml');
  writeFileSync(metrics, sample);
  writeFileSync(join(folder, 'metrics.pin.json'), pin(Buffer.from(sample)));
  writeFileSync(join(folder, 'sales.csv'), sales);
  writeFileSync(join(folder, 'expenses.csv'), JSON.stringify({
    response: { result: { path: 'expenses.csv', contentBase64: Buffer.from(expenses).toString('base64') }, evidence: [{ evidenceId: 'evd_ffffffffffffffffffffffffffffffff' }] },
  }));
  const columns = { date: '记账日期', account: '账户', kind: '类型', amount: '金额' };
  const sources = [
    { name: 'sales', columns, source: { savedAs: 'sales.csv' } },
    { name: 'expenses', columns, source: { savedAs: 'expenses.csv' } },
  ];
  const paths = writePair(folder, sources);
  const gate = gateReport(folder, paths.left, paths.right, metrics, join(folder, 'metrics.pin.json'));
  assert.equal(gate.summary.margin, 105);
  assert.equal(gate.summary.rows[0].account, '华北');
  assert.equal(gate.summary.rejected.length, 0);
  assert.equal(gate.summary.totals[0].formula, FORMULAS.revenue);
  assert.equal(gate.summary.totals[2].formula, 'B1-B2');
  emitReport(folder, paths.left, paths.right, metrics);
  const sheet = readFileSync(join(folder, 'out', 'report.xlsx')).toString('utf8');
  assert.match(sheet, /SUMIF\(Lines!C:C,&quot;revenue&quot;,Lines!D:D\)/);
  assert.match(sheet, /<f>B1-B2<\/f><v>105<\/v>/);
  writeFileSync(join(folder, 'refunds.csv'), '记账日期,账户,类型,金额\n2026-09-01,华北,退款,1\n');
  const refunds = writePair(folder, [{ name: 'refunds', columns, source: { savedAs: 'refunds.csv' } }]);
  const refused = gateReport(folder, refunds.left, refunds.right, metrics, join(folder, 'metrics.pin.json'));
  assert.deepEqual(refused.summary.rejected.map((row) => row.reason), ['unapproved_kind']);
  assert.equal(refused.summary.acceptedTotal, 0);
  const missing = writePair(folder, [{ name: 'sales', columns: { ...columns, amount: '120' }, source: { savedAs: 'sales.csv' } }]);
  assert.throws(() => gateReport(folder, missing.left, missing.right, metrics, join(folder, 'metrics.pin.json')), /header_not_in_source/);
  const transcribed = writePair(folder, [{ name: 'sales', columns, source: { savedAs: 'sales.csv', rows: [] } }]);
  assert.throws(() => gateReport(folder, transcribed.left, transcribed.right, metrics, join(folder, 'metrics.pin.json')), /pointer_not_transcribe/);
  assert.equal(pinPath.endsWith('metrics.sample.pin.json'), true);
});

test('a Chinese ledger keeps the period total and lists the rows that do not belong in it', () => {
  const folder = mkdtempSync(join(tmpdir(), 'report-zh-'));
  const metrics = join(folder, 'metrics.yaml');
  writeFileSync(metrics, sample);
  const pinFile = join(folder, 'pin.json');
  writeFileSync(pinFile, pin(Buffer.from(sample)));
  writeFileSync(join(folder, 'ledger.zh.csv'), ledger);
  const columns = { date: '记账日期', account: '部门', kind: '摘要', amount: '发生额' };
  const sources = [{ name: 'ledger', columns, source: { savedAs: 'ledger.zh.csv' } }];
  const paths = writePair(folder, sources);
  const gate = gateReport(folder, paths.left, paths.right, metrics, pinFile);
  assert.equal(gate.summary.acceptedTotal, 16426400);
  assert.deepEqual(gate.summary.rejected.map((row) => row.reason), ['outside_period', 'bad_date', 'empty_amount', 'negative_amount']);
  assert.equal(gate.summary.reconcile.rejectedNumeric, 98399);
  assert.equal(gate.summary.reconcile.naivePositive, 16524799);
  assert.equal(gate.summary.rows.some((row) => row.amount === 0), false);
  const other = [{ name: 'ledger', columns: { ...columns, amount: '金额' }, source: { savedAs: 'ledger.zh.csv' } }];
  const disagreed = writePair(folder, sources, other);
  const human = gateReport(folder, disagreed.left, disagreed.right, metrics, pinFile);
  assert.equal(human.needsHuman, true);
  assert.equal(human.summary, null);
  const emitted = emitReport(folder, disagreed.left, disagreed.right, metrics);
  assert.equal(emitted.acceptedTotal, null);
  assert.doesNotMatch(readFileSync(join(folder, 'out', 'report.json'), 'utf8'), /16524799|16426400/);
});
