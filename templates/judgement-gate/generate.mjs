#!/usr/bin/env node
// Copy the judgement-gate scaffold into a new skill directory.
//   node templates/judgement-gate/generate.mjs <id> --title "..." --title-zh "..." [--owner enterprise] [--tool docs.get] [--dest <dir>] [--force]
import { cpSync, existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const scaffold = join(dirname(fileURLToPath(import.meta.url)), 'scaffold');

export function hubToolName(tool) {
  return `hub_tool_${tool.replace(/[^A-Za-z0-9_]/g, '_')}`;
}

export function generate(options) {
  const id = options.id;
  if (typeof id !== 'string' || !/^[a-z][a-z0-9-]{0,99}$/.test(id)) throw new Error('id must match ^[a-z][a-z0-9-]{0,99}$');
  for (const key of ['title', 'titleZh', 'owner', 'tool']) if (typeof options[key] !== 'string' || !options[key].trim()) throw new Error(`${key} is required`);
  const dest = options.dest ?? join(root, 'skills', id);
  if (existsSync(dest) && !options.force) throw new Error(`${dest} already exists`);
  mkdirSync(dest, { recursive: true });
  const tokens = {
    __ID__: id,
    __TITLE__: options.title,
    __TITLE_ZH__: options.titleZh,
    __OWNER__: options.owner,
    __TOOL__: options.tool,
    __TOOL_HUB__: hubToolName(options.tool),
  };
  const copy = (from, to) => {
    for (const entry of readdirSync(from, { withFileTypes: true })) {
      const source = join(from, entry.name);
      const target = join(to, entry.name);
      if (entry.isDirectory()) {
        mkdirSync(target, { recursive: true });
        copy(source, target);
      } else {
        let text = readFileSync(source, 'utf8');
        for (const [token, value] of Object.entries(tokens)) text = text.replaceAll(token, value);
        writeFileSync(target, text);
      }
    }
  };
  copy(scaffold, dest);
  const manifest = JSON.parse(readFileSync(join(dest, 'skillpack.json'), 'utf8'));
  if (manifest.id !== id) throw new Error('generated id mismatch');
  return dest;
}

if (process.argv[1] && import.meta.url === `file://${process.argv[1]}`) {
  const [id, ...rest] = process.argv.slice(2);
  const args = { owner: 'enterprise', tool: 'docs.get', force: false };
  for (let i = 0; i < rest.length; i++) {
    if (rest[i] === '--title') args.title = rest[++i];
    else if (rest[i] === '--title-zh') args.titleZh = rest[++i];
    else if (rest[i] === '--owner') args.owner = rest[++i];
    else if (rest[i] === '--tool') args.tool = rest[++i];
    else if (rest[i] === '--dest') args.dest = rest[++i];
    else if (rest[i] === '--force') args.force = true;
  }
  if (!id || !args.title || !args.titleZh) {
    console.error('usage: node templates/judgement-gate/generate.mjs <id> --title "..." --title-zh "..." [--owner enterprise] [--tool docs.get] [--dest <dir>] [--force]');
    process.exit(2);
  }
  const dest = generate({ id, ...args });
  if (!statSync(join(dest, 'scripts', 'pointers.mjs')).isFile()) process.exit(1);
  console.log(dest);
}
