#!/usr/bin/env node
// Emit only what the gate recomputed. A contract edited after the gate is refused.
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { readJson, sha256 } from './pointers.mjs';

export function emitGated(folder, contractPath) {
  const gate = readJson(join(folder, 'gate.json'));
  if (gate?.ok !== true || gate.origin !== 'script') throw new Error('gate_not_passed');
  const bytes = readFileSync(contractPath);
  if (sha256(bytes) !== gate.contractSha256) throw new Error('contract_changed_after_gate');
  const body = {
    origin: 'script',
    items: gate.items.map((item) => ({ id: item.id, quote: item.quote, evidenceId: item.evidenceId, origin: 'script' })),
  };
  mkdirSync(join(folder, 'out'), { recursive: true });
  writeFileSync(join(folder, 'out', 'summary.json'), `${JSON.stringify(body, null, 2)}\n`);
  return body;
}

if (process.argv[1] && import.meta.url === `file://${process.argv[1]}`) {
  const [folder, ...rest] = process.argv.slice(2);
  let contract;
  for (let i = 0; i < rest.length; i++) if (rest[i] === '--contract') contract = rest[++i];
  if (!folder || !contract) {
    console.error('usage: node emit.mjs <folder> --contract <file>');
    process.exit(2);
  }
  emitGated(folder, contract);
}
