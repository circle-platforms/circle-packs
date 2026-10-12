import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createHash } from 'node:crypto';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { collect, digestOf, render, SCHEMA } from './modules.ts';

const repo = (t: { after: (fn: () => void) => void }) => {
  const dir = mkdtempSync(join(tmpdir(), 'circle-packs-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  return dir;
};
const put = (path: string, text: string) => {
  mkdirSync(join(path, '..'), { recursive: true });
  writeFileSync(path, text);
};

test('a skill pack is listed with its manifest, version and the SHA-256 of every file it ships', (t) => {
  const dir = repo(t);
  put(join(dir, 'skills/demo/skillpack.json'), JSON.stringify({ id: 'demo', version: '1.2.0' }));
  put(join(dir, 'skills/demo/SKILL.md'), '# demo\n');
  put(join(dir, 'skills/demo/scripts/run.mjs'), 'export {};\n');
  put(join(dir, 'skills/demo/.DS_Store'), 'ignored');
  const list = collect(dir);
  assert.equal(list.schema, SCHEMA);
  const [entry] = list.modules;
  assert.deepEqual(
    { id: entry.id, kind: entry.kind, root: entry.root, manifestPath: entry.manifestPath, version: entry.version },
    { id: 'demo', kind: 'skill-pack', root: 'skills/demo', manifestPath: 'skills/demo/skillpack.json', version: '1.2.0' },
  );
  assert.deepEqual(entry.files.map((file) => file.path), ['SKILL.md', 'scripts/run.mjs', 'skillpack.json'], 'sorted, hidden files left out');
  assert.equal(entry.files[0].sha256, createHash('sha256').update('# demo\n').digest('hex'));
});

test('the digest is the SHA-256 of the sha256sum listing, so it changes with any byte', (t) => {
  const files = [
    { path: 'a.txt', sha256: 'a'.repeat(64) },
    { path: 'b/c.txt', sha256: 'b'.repeat(64) },
  ];
  const listing = `${'a'.repeat(64)}  a.txt\n${'b'.repeat(64)}  b/c.txt\n`;
  assert.equal(digestOf(files), createHash('sha256').update(listing).digest('hex'));
  const dir = repo(t);
  put(join(dir, 'skills/demo/skillpack.json'), JSON.stringify({ id: 'demo', version: '1.0.0' }));
  const before = collect(dir).modules[0].digest;
  put(join(dir, 'skills/demo/SKILL.md'), 'changed');
  assert.notEqual(collect(dir).modules[0].digest, before);
});

test('a manifest whose id differs from its folder, or an id used twice, is refused', (t) => {
  const dir = repo(t);
  put(join(dir, 'skills/demo/skillpack.json'), JSON.stringify({ id: 'other', version: '1.0.0' }));
  assert.throws(() => collect(dir), /differs from its folder/);
  const missing = repo(t);
  put(join(missing, 'skills/demo/skillpack.json'), JSON.stringify({ id: 'demo' }));
  assert.throws(() => collect(missing), /id and version are required/);
});

test('modules.json in this repository matches its files', () => {
  const here = join(import.meta.dirname, '..');
  assert.equal(readFileSync(join(here, 'modules.json'), 'utf8'), render(collect(here)));
});
