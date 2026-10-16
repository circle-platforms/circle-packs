import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { emitReport, FORMULAS, gateReport } from '../scripts/aggregate.mjs';

const sample = readFileSync(fileURLToPath(new URL('../references/metrics.sample.yaml', import.meta.url)), 'utf8');
const sales = readFileSync(fileURLToPath(new URL('./fixtures/sales.zh.csv', import.meta.url)), 'utf8');
const expenses = readFileSync(fileURLToPath(new URL('./fixtures/expenses.zh.csv', import.meta.url)), 'utf8');

test('raw CSV is aggregated from a header map, and a transcribed cell is refused', () => {
  const folder = mkdtempSync(join(tmpdir(), 'report-'));
  const metrics = join(folder, 'metrics.yaml');
  writeFileSync(metrics, sample);
  writeFileSync(join(folder, 'sales.csv'), sales);
  writeFileSync(join(folder, 'expenses.csv'), JSON.stringify({
    response: { result: { path: 'expenses.csv', contentBase64: Buffer.from(expenses).toString('base64') }, evidence: [{ evidenceId: 'evd_ffffffffffffffffffffffffffffffff' }] },
  }));
  const contract = join(folder, 'sources.contract.json');
  const columns = { account: '账户', kind: '类型', amount: '金额' };
  writeFileSync(contract, JSON.stringify({
    schema: 'enterprise/sources/2',
    origin: 'model',
    sources: [
      { name: 'sales', columns, source: { savedAs: 'sales.csv' } },
      { name: 'expenses', columns, source: { savedAs: 'expenses.csv' } },
    ],
  }));
  const gate = gateReport(folder, contract, metrics);
  assert.equal(gate.summary.margin, 105);
  assert.equal(gate.summary.rows[0].account, '华北');
  assert.equal(gate.summary.totals[0].formula, FORMULAS.revenue);
  assert.equal(gate.summary.totals[2].formula, 'B1-B2');
  emitReport(folder, contract, metrics);
  const sheet = readFileSync(join(folder, 'out', 'report.xlsx')).toString('utf8');
  assert.match(sheet, /SUMIF\(Lines!C:C,&quot;revenue&quot;,Lines!D:D\)/);
  assert.match(sheet, /<f>B1-B2<\/f><v>105<\/v>/);
  writeFileSync(join(folder, 'refunds.csv'), '账户,类型,金额\n华北,退款,1\n');
  writeFileSync(contract, JSON.stringify({
    schema: 'enterprise/sources/2',
    origin: 'model',
    sources: [{ name: 'refunds', columns, source: { savedAs: 'refunds.csv' } }],
  }));
  assert.throws(() => gateReport(folder, contract, metrics), /not an approved metric/);
  writeFileSync(contract, JSON.stringify({
    schema: 'enterprise/sources/2',
    origin: 'model',
    sources: [{ name: 'sales', columns: { account: '账户', kind: '类型', amount: '120' }, source: { savedAs: 'sales.csv' } }],
  }));
  assert.throws(() => gateReport(folder, contract, metrics), /header_not_in_source/);
  writeFileSync(contract, JSON.stringify({
    schema: 'enterprise/sources/2',
    origin: 'model',
    sources: [{ name: 'sales', columns, source: { savedAs: 'sales.csv', rows: [] } }],
  }));
  assert.throws(() => gateReport(folder, contract, metrics), /pointer_not_transcribe/);
});
