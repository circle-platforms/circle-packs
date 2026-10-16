import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { aggregate, FORMULAS } from '../scripts/aggregate.mjs';

test('several sources become one workbook whose summary cells are formulas', () => {
  const folder = mkdtempSync(join(tmpdir(), 'report-'));
  const summary = aggregate(folder, '2026-09', [
    { name: 'sales', rows: [{ account: 'north', kind: 'revenue', amount: 120 }, { account: 'south', kind: 'revenue', amount: 30 }] },
    { name: 'expenses', rows: [{ account: 'north', kind: 'expense', amount: 45 }] },
  ]);
  assert.equal(summary.margin, 105);
  assert.equal(summary.formulas.revenue, FORMULAS.revenue);
  const bytes = readFileSync(join(folder, 'out', 'report.xlsx'));
  const sheet = bytes.toString('utf8');
  assert.match(sheet, /SUMIF\(Lines!C:C,&quot;revenue&quot;,Lines!D:D\)/);
  assert.match(sheet, /<f>B1-B2<\/f><v>105<\/v>/);
  assert.throws(() => aggregate(folder, '2026-09', [{ name: 'sales', rows: [{ account: 'north', kind: 'refund', amount: 1 }] }]), /revenue or expense/);
});
