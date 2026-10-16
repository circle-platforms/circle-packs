import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
const CJK = /[\u3400-\u9fff]/;
const MANIFEST_KEYS = ['id', 'inputs', 'model', 'outputs', 'owner', 'title', 'tools', 'triggers', 'version'];

function walk(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    return entry.isDirectory() ? walk(path) : [path];
  });
}

test('skill manifests are English and use only SkillManifest keys', () => {
  const skills = readdirSync(join(root, 'skills')).filter((name) => statSync(join(root, 'skills', name)).isDirectory());
  assert.ok(skills.length >= 10);
  for (const id of skills) {
    const manifestPath = join(root, 'skills', id, 'skillpack.json');
    const raw = readFileSync(manifestPath, 'utf8');
    assert.doesNotMatch(raw, CJK, `${id} skillpack.json is English`);
    const manifest = JSON.parse(raw);
    assert.deepEqual(Object.keys(manifest).sort(), MANIFEST_KEYS, `${id} has no extra manifest keys`);
    const front = readFileSync(join(root, 'skills', id, 'SKILL.md'), 'utf8').match(/^---\n([\s\S]*?)\n---/);
    assert.ok(front, `${id} SKILL.md has frontmatter`);
    assert.match(front[1], /^titleZh: .+\S/m, `${id} frontmatter carries titleZh`);
  }
});

test('product-line manifests do not carry a title field', () => {
  for (const id of ['apv', 'enterprise']) {
    const manifest = JSON.parse(readFileSync(join(root, 'products', id, 'product-line.json'), 'utf8'));
    assert.equal(manifest.title, undefined);
    assert.equal(manifest.titleZh, undefined);
  }
});

test('packs do not ship a hidden harness path', () => {
  for (const dir of ['skills', 'products']) {
    for (const path of walk(join(root, dir))) {
      const rel = relative(root, path).split(sep).join('/');
      assert.equal(rel.split('/').some((part) => part.includes('.claude')), false, rel);
      assert.equal(readFileSync(path, 'utf8').includes('.claude'), false, rel);
    }
  }
});
