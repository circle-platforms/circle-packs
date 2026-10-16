#!/usr/bin/env node
import { readFileSync } from 'node:fs';
import { emitOnboarding } from './onboard.mjs';

const [folder, ...rest] = process.argv.slice(2);
const args = {};
for (let i = 0; i < rest.length; i++) if (rest[i].startsWith('--')) args[rest[i].slice(2)] = rest[++i];
if (!folder || !args.rules || !args.checklist || !args.requests) {
  console.error('usage: node emit.mjs <folder> --rules <file> --checklist <file> --requests <file>');
  process.exit(2);
}
const read = (path) => JSON.parse(readFileSync(path, 'utf8'));
emitOnboarding(folder, args.rules, read(args.checklist), read(args.requests));
