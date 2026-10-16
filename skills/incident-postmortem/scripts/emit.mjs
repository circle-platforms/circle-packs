#!/usr/bin/env node
import { emitPostmortem } from './timeline.mjs';

const [folder, ...rest] = process.argv.slice(2);
const args = {};
for (let i = 0; i < rest.length; i++) if (rest[i].startsWith('--')) args[rest[i].slice(2)] = rest[++i];
if (!folder || !args.left || !args.right || !args.policy) {
  console.error('usage: node emit.mjs <folder> --left <file> --right <file> --policy <file>');
  process.exit(2);
}
emitPostmortem(folder, args.left, args.right, args.policy);
