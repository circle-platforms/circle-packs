#!/usr/bin/env node
import { emitTriage } from './triage.mjs';

const [folder, ...rest] = process.argv.slice(2);
const args = {};
for (let i = 0; i < rest.length; i++) if (rest[i].startsWith('--')) args[rest[i].slice(2)] = rest[++i];
if (!folder || !args.contract || !args.policy) {
  console.error('usage: node emit.mjs <folder> --contract <file> --policy <file>');
  process.exit(2);
}
emitTriage(folder, args.contract, args.policy);
