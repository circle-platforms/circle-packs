import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { generate } from '../templates/judgement-gate/generate.mjs';

const root = fileURLToPath(new URL('..', import.meta.url));
const pointers = join(root, 'templates/judgement-gate/scaffold/scripts/pointers.mjs');

test('the generator writes a skill whose pointers match the template', () => {
  const parent = mkdtempSync(join(tmpdir(), 'scaffold-skill-'));
  const dest = join(parent, 'scaffold-demo');
  const written = generate({ id: 'scaffold-demo', title: 'Scaffold demo', titleZh: '脚手架示例', owner: 'enterprise', tool: 'docs.get', dest });
  assert.equal(written, dest);
  const manifest = JSON.parse(readFileSync(join(dest, 'skillpack.json'), 'utf8'));
  assert.equal(manifest.id, 'scaffold-demo');
  assert.equal(manifest.title, 'Scaffold demo');
  assert.doesNotMatch(JSON.stringify(manifest), /[\u3400-\u9fff]/);
  const skill = readFileSync(join(dest, 'SKILL.md'), 'utf8');
  assert.match(skill, /titleZh: 脚手架示例/);
  assert.match(skill, /Circle 1\.7\.0/);
  assert.match(skill, /hub_tool_docs_get/);
  assert.equal(readFileSync(join(dest, 'scripts/pointers.mjs'), 'utf8'), readFileSync(pointers, 'utf8'));
  rmSync(parent, { recursive: true, force: true });
});

test('enterprise skills keep the template pointer script', () => {
  const canonical = readFileSync(pointers, 'utf8');
  for (const id of ['contract-review', 'monthly-business-report', 'support-triage', 'employee-onboarding', 'incident-postmortem']) {
    assert.equal(readFileSync(join(root, 'skills', id, 'scripts', 'pointers.mjs'), 'utf8'), canonical, id);
  }
});
