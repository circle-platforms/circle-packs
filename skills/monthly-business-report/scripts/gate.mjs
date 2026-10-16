#!/usr/bin/env node
import { gateReport } from './aggregate.mjs';

if (process.argv[1] && import.meta.url === `file://${process.argv[1]}`) {
  const [folder, ...rest] = process.argv.slice(2);
  const args = {};
  for (let i = 0; i < rest.length; i++) if (rest[i].startsWith('--')) args[rest[i].slice(2)] = rest[++i];
  if (!folder || !args.left || !args.right || !args.metrics || !args.pin) {
    console.error('usage: node gate.mjs <folder> --left <file> --right <file> --metrics <metrics.yaml> --pin <pin.json>');
    process.exit(2);
  }
  gateReport(folder, args.left, args.right, args.metrics, args.pin);
}
