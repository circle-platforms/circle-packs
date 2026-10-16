import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { extractClauses, reviewContract } from '../scripts/clauses.mjs';

test('missing required headings become script claims and model notes are copied', () => {
  const text = '# Payment terms\nNet 30.\n# Termination\n30 days.\n';
  assert.deepEqual(extractClauses(text).gaps, ['Liability', 'Data protection']);
  const folder = mkdtempSync(join(tmpdir(), 'contract-'));
  const saved = {
    result: { path: 'contracts/example.txt', contentBase64: Buffer.from(text).toString('base64') },
    evidenceId: 'evd_bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
  };
  const review = { origin: 'model', findings: [{ clauseId: 'c1', risk: 'low', note: 'Net 30 is stated.' }] };
  const result = reviewContract(folder, saved, review);
  assert.equal(result.claims.length, 2);
  assert.equal(result.claims[0].origin, 'script');
  assert.match(readFileSync(join(folder, 'out', 'review_report.md'), 'utf8'), /Net 30 is stated/);
  assert.throws(() => reviewContract(folder, saved, { origin: 'script', findings: [] }), /model judgement/);
});
