#!/usr/bin/env node
import { emitReport } from './aggregate.mjs';

if (process.argv[1] && import.meta.url === `file://${process.argv[1]}`) {
  const [folder, ...rest] = process.argv.slice(2);
  const args = {};
  for (let i = 0; i < rest.length; i++) if (rest[i].startsWith('--')) args[rest[i].slice(2)] = rest[++i];
  if (!folder || !args.left || !args.right || !args.metrics) {
    console.error('usage: node emit.mjs <folder> --left <file> --right <file> --metrics <metrics.yaml>');
    process.exit(2);
  }
  emitReport(folder, args.left, args.right, args.metrics);
}
