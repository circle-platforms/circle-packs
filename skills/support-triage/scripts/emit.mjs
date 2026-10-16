#!/usr/bin/env node
import { emitTriage } from './triage.mjs';

const [folder, ...rest] = process.argv.slice(2);
let contract;
for (let i = 0; i < rest.length; i++) if (rest[i] === '--contract') contract = rest[++i];
if (!folder || !contract) {
  console.error('usage: node emit.mjs <folder> --contract <file>');
  process.exit(2);
}
emitTriage(folder, contract);
