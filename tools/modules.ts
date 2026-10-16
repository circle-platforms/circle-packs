// The module list a circle-hub installer reads: for each module its root, the manifest it
// declares itself with, its version, and the SHA-256 of every file it ships. The installer
// freezes exactly these bytes and submits them through the platform's own registration and
// independent approval; nothing here approves anything.
//   node tools/modules.ts write   rewrite modules.json from the files on disk
//   node tools/modules.ts check   exit 1 when modules.json differs from the files on disk
import { createHash } from 'node:crypto';
import { readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

export const SCHEMA = 'circle-packs/modules/1';

// Where modules live and what kind each is. A skill pack declares itself in skillpack.json;
// a product line (added later) in product-line.json.
const KINDS: { dir: string; kind: string; manifest: string }[] = [
  { dir: 'skills', kind: 'skill-pack', manifest: 'skillpack.json' },
  { dir: 'products', kind: 'product-line', manifest: 'product-line.json' },
];

export interface ModuleFile {
  path: string;
  sha256: string;
}
export interface ModuleEntry {
  id: string;
  kind: string;
  root: string;
  manifestPath: string;
  version: string;
  files: ModuleFile[];
  digest: string;
}

const sha256 = (bytes: Buffer | string): string => createHash('sha256').update(bytes).digest('hex');
const posix = (path: string): string => path.split(sep).join('/');

function walk(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true })
    .filter((entry) => !entry.name.startsWith('.'))
    .flatMap((entry) => (entry.isDirectory() ? walk(join(dir, entry.name)) : [join(dir, entry.name)]));
}

// The digest is the SHA-256 of the files listed as `sha256sum` prints them, sorted by path
// (code point order): "<sha256>  <path>\n" per file. Anyone can recompute it with shell tools.
export function digestOf(files: ModuleFile[]): string {
  return sha256(files.map((file) => `${file.sha256}  ${file.path}\n`).join(''));
}

export function readModule(repo: string, root: string, kind: string, manifest: string): ModuleEntry {
  const manifestPath = posix(join(root, manifest));
  const declared = JSON.parse(readFileSync(join(repo, manifestPath), 'utf8'));
  if (typeof declared.id !== 'string' || typeof declared.version !== 'string')
    throw new Error(`${manifestPath}: id and version are required`);
  if (posix(root).split('/').at(-1) !== declared.id) throw new Error(`${manifestPath}: id ${declared.id} differs from its folder`);
  const files = walk(join(repo, root))
    .map((path) => ({ path: posix(relative(join(repo, root), path)), sha256: sha256(readFileSync(path)) }))
    .sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
  return { id: declared.id, kind, root: posix(root), manifestPath, version: declared.version, files, digest: digestOf(files) };
}

export function collect(repo: string): { schema: string; modules: ModuleEntry[] } {
  const modules: ModuleEntry[] = [];
  for (const { dir, kind, manifest } of KINDS) {
    let names: string[] = [];
    try {
      if (statSync(join(repo, dir)).isDirectory()) names = readdirSync(join(repo, dir)).filter((name) => !name.startsWith('.')).sort();
    } catch {
      continue;
    }
    for (const name of names) modules.push(readModule(repo, join(dir, name), kind, manifest));
  }
  const ids = modules.map((module) => module.id);
  const repeated = ids.find((id, index) => ids.indexOf(id) !== index);
  if (repeated) throw new Error(`module id ${repeated} is used twice`);
  return { schema: SCHEMA, modules };
}

export const render = (list: ReturnType<typeof collect>): string => `${JSON.stringify(list, null, 2)}\n`;

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const repo = join(fileURLToPath(import.meta.url), '..', '..');
  const [command] = process.argv.slice(2);
  const expected = render(collect(repo));
  if (command === 'write') {
    writeFileSync(join(repo, 'modules.json'), expected);
    console.log('modules.json written');
  } else if (command === 'check') {
    let current = '';
    try {
      current = readFileSync(join(repo, 'modules.json'), 'utf8');
    } catch {}
    if (current !== expected) {
      console.error('modules.json does not match the files: run node tools/modules.ts write');
      process.exit(1);
    }
    console.log('modules.json matches the files');
  } else {
    console.error('usage: node tools/modules.ts write | check');
    process.exit(2);
  }
}
