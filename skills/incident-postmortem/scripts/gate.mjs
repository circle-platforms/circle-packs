#!/usr/bin/env node
import { gateLabels } from './timeline.mjs';

const [folder, ...rest] = process.argv.slice(2);
const args = {};
for (let i = 0; i < rest.length; i++) if (rest[i].startsWith('--')) args[rest[i].slice(2)] = rest[++i];
if (!folder || !args.left || !args.right || !args.policy || !args.pin) {
  console.error('usage: node gate.mjs <folder> --left <file> --right <file> --policy <file> --pin <file>');
  process.exit(2);
}
gateLabels(folder, args.left, args.right, args.policy, args.pin);
