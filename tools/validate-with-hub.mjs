// Parse every skillpack and product line with the circle-hub schemas.
//   HUB_ROOT=../circle-hub node --experimental-strip-types tools/validate-with-hub.mjs
// Exits 0 with a skip line when HUB_ROOT is unset and ../circle-hub is absent.
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import { pathToFileURL, fileURLToPath } from 'node:url';

const repo = fileURLToPath(new URL('..', import.meta.url));
const hub = process.env.HUB_ROOT || join(repo, '..', 'circle-hub');

const isDir = (path) => {
  try {
    return statSync(path).isDirectory();
  } catch {
    return false;
  }
};

if (!process.env.HUB_ROOT && !isDir(hub)) {
  console.log('validate-with-hub: skipped (no HUB_ROOT and no ../circle-hub)');
  process.exit(0);
}
if (!isDir(hub)) {
  console.error(`validate-with-hub: HUB_ROOT is not a directory (${hub})`);
  process.exit(1);
}

const productModules = join(hub, 'packages/methods/src/product-modules.ts');
if (!isDir(join(hub, 'packages/methods/src')) || !statSync(productModules, { throwIfNoEntry: false })?.isFile()) {
  console.error('validate-with-hub: this checkout has no verifyProductLine. Use a circle-hub that contains packages/methods/src/product-modules.ts');
  process.exit(1);
}

const contracts = await import(pathToFileURL(join(hub, 'packages/contracts/src/index.ts')).href);
const productLines = await import(pathToFileURL(join(hub, 'packs/product-lines.ts')).href);
const modules = await import(pathToFileURL(productModules).href);
const { SkillManifest, SkillPackSubmission } = contracts;
const { ProductLineManifest } = productLines;
const { verifyProductLine } = modules;

function filesOf(dir) {
  const map = new Map();
  const walk = (current) => {
    for (const entry of readdirSync(current, { withFileTypes: true })) {
      if (entry.name.startsWith('.')) continue;
      const path = join(current, entry.name);
      if (entry.isDirectory()) walk(path);
      else map.set(relative(dir, path).split(sep).join('/'), readFileSync(path, 'utf8'));
    }
  };
  walk(dir);
  return map;
}

const skills = readdirSync(join(repo, 'skills')).filter((name) => isDir(join(repo, 'skills', name)));
for (const id of skills) {
  const manifest = SkillManifest.parse(JSON.parse(readFileSync(join(repo, 'skills', id, 'skillpack.json'), 'utf8')));
  if (manifest.id !== id) throw new Error(`${id}: manifest id differs from its folder`);
  const trialPath = join(repo, 'skills', id, 'references', 'trial.json');
  if (!isDir(join(repo, 'skills', id, 'references')) || !statSync(trialPath, { throwIfNoEntry: false })?.isFile()) continue;
  const trial = SkillPackSubmission.shape.trial.parse(JSON.parse(readFileSync(trialPath, 'utf8')));
  const returned = trial.outputs.map((output) => output.path).sort();
  const declared = [...manifest.outputs].sort();
  if (returned.join('\n') !== declared.join('\n')) throw new Error(`${id}: trial outputs differ from manifest.outputs`);
  console.log(`skill ${id} ${manifest.version} trial`);
}

for (const id of readdirSync(join(repo, 'products')).filter((name) => isDir(join(repo, 'products', name)))) {
  const dir = join(repo, 'products', id);
  const manifest = ProductLineManifest.parse(JSON.parse(readFileSync(join(dir, 'product-line.json'), 'utf8')));
  if (manifest.id !== id) throw new Error(`${id}: manifest id differs from its folder`);
  verifyProductLine(manifest, filesOf(dir));
  console.log(`product-line ${id} ${manifest.version}`);
}

console.log(`validate-with-hub: ${skills.length} skills, hub ${hub}`);
