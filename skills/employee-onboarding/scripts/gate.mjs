#!/usr/bin/env node
import { gateOnboarding } from './onboard.mjs';

const [folder, ...rest] = process.argv.slice(2);
const args = {};
for (let i = 0; i < rest.length; i++) if (rest[i].startsWith('--')) args[rest[i].slice(2)] = rest[++i];
if (!folder || !args.rules) {
  console.error('usage: node gate.mjs <folder> --rules <policy_rules.json>');
  process.exit(2);
}
gateOnboarding(folder, args.rules);
