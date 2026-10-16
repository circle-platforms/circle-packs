#!/usr/bin/env node
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { compareExtracts, gateOnboarding } from './onboard.mjs';

const [folder, ...rest] = process.argv.slice(2);
const args = {};
for (let i = 0; i < rest.length; i++) if (rest[i].startsWith('--')) args[rest[i].slice(2)] = rest[++i];
if (folder && args.left && args.right && !args.rules) {
  writeFileSync(join(folder, 'compare.json'), `${JSON.stringify(compareExtracts(args.left, args.right), null, 2)}\n`);
} else if (folder && args.rules && args.pin) {
  gateOnboarding(folder, args.rules, args.pin);
} else {
  console.error('usage: node gate.mjs <folder> --rules <approved.json> --pin <pin.json>');
  console.error('       node gate.mjs <folder> --left <extract.json> --right <extract.json>');
  process.exit(2);
}
