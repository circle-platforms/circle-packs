import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtempSync, writeFileSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { loadSaved, summarise, writeSummary } from '../scripts/summarise.mjs';

const sha256 = (text) => createHash('sha256').update(text).digest('hex');

test('the local script counts lines and words and writes the declared output', () => {
  assert.deepEqual(summarise('alpha beta\ngamma\n'), { lineCount: 2, wordCount: 3, origin: 'script' });
  const folder = mkdtempSync(join(tmpdir(), 'local-script-'));
  const text = 'alpha beta\ngamma\n';
  const saved = join(folder, 'get.json');
  writeFileSync(saved, JSON.stringify({
    response: { result: { path: 'sources/synthetic-note.txt', contentBase64: Buffer.from(text).toString('base64') }, evidence: [{ evidenceId: 'evd_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa' }] },
  }));
  writeSummary(folder, JSON.parse(readFileSync(saved, 'utf8')).response.result);
  const body = readFileSync(join(folder, 'out', 'summary.json'), 'utf8');
  assert.equal(body, `${JSON.stringify({ lineCount: 2, wordCount: 3, origin: 'script' }, null, 2)}\n`);
  const trial = JSON.parse(readFileSync(new URL('../references/trial.json', import.meta.url), 'utf8'));
  assert.deepEqual(Object.keys(trial).sort(), ['outputs', 'toolCalls']);
  assert.equal(trial.toolCalls[0].name, 'docs.get');
  assert.equal(trial.toolCalls[0].argsSha256, sha256('{"file":"sources/synthetic-note.txt"}'));
  assert.equal(trial.outputs[0].path, 'out/summary.json');
  assert.equal(trial.outputs[0].sha256, sha256(body));
});

test('docs.get accepts a user-provided local file', () => {
  const folder = mkdtempSync(join(tmpdir(), 'local-script-zh-'));
  const note = join(folder, 'note.zh.txt');
  writeFileSync(note, '合同 评审\n补充\n');
  const summary = writeSummary(folder, loadSaved(folder, note));
  assert.deepEqual(summary, { lineCount: 2, wordCount: 3, origin: 'script' });
});
