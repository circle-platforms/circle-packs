import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { emitReport, FORMULAS, gateReport } from '../scripts/aggregate.mjs';

const sample = readFileSync(fileURLToPath(new URL('../references/metrics.sample.yaml', import.meta.url)), 'utf8');

function saved(folder, name, body) {
  const path = join(folder, name);
  writeFileSync(path, JSON.stringify({ response: { result: { path: name, contentBase64: Buffer.from(JSON.stringify(body)).toString('base64') }, evidence: [{ evidenceId: 'evd_ffffffffffffffffffffffffffffffff' }] } }));
  return name;
}

test('approved metrics become formulas and an unapproved kind is refused', () => {
  const folder = mkdtempSync(join(tmpdir(), 'report-'));
  const metrics = join(folder, 'metrics.yaml');
  writeFileSync(metrics, sample);
  saved(folder, 'sales.json', { name: 'sales', rows: [{ account: 'north', kind: 'revenue', amount: 120 }, { account: 'south', kind: 'revenue', amount: 30 }] });
  saved(folder, 'expenses.json', { name: 'expenses', rows: [{ account: 'north', kind: 'expense', amount: 45 }] });
  const contract = join(folder, 'sources.contract.json');
  writeFileSync(contract, JSON.stringify({
    schema: 'enterprise/sources/1',
    origin: 'model',
    sources: [{ savedAs: 'sales.json' }, { savedAs: 'expenses.json' }],
  }));
  const gate = gateReport(folder, contract, metrics);
  assert.equal(gate.summary.margin, 105);
  assert.equal(gate.summary.totals[0].formula, FORMULAS.revenue);
  assert.equal(gate.summary.totals[2].formula, 'B1-B2');
  emitReport(folder, contract, metrics);
  const sheet = readFileSync(join(folder, 'out', 'report.xlsx')).toString('utf8');
  assert.match(sheet, /SUMIF\(Lines!C:C,&quot;revenue&quot;,Lines!D:D\)/);
  assert.match(sheet, /<f>B1-B2<\/f><v>105<\/v>/);
  saved(folder, 'refunds.json', { name: 'refunds', rows: [{ account: 'north', kind: 'refund', amount: 1 }] });
  writeFileSync(contract, JSON.stringify({ schema: 'enterprise/sources/1', origin: 'model', sources: [{ savedAs: 'refunds.json' }] }));
  assert.throws(() => gateReport(folder, contract, metrics), /not an approved metric/);
  writeFileSync(contract, JSON.stringify({ schema: 'enterprise/sources/1', origin: 'model', sources: [{ savedAs: 'sales.json', rows: [] }] }));
  assert.throws(() => gateReport(folder, contract, metrics), /pointer_not_transcribe/);
});
