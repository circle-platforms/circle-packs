#!/usr/bin/env node
// Hash a policy file the company has approved. The gate refuses any other bytes.
// A person sets "approved" to true after reviewing the file. Do not re-extract that file on later runs.
import { readFileSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';

export function pinDocument(bytes, approved = false) {
  return {
    schema: 'circle-packs/policy-pin/1',
    sha256: createHash('sha256').update(bytes).digest('hex'),
    approved,
  };
}

if (process.argv[1] && import.meta.url === `file://${process.argv[1]}`) {
  const [file, ...rest] = process.argv.slice(2);
  const args = { approved: false };
  for (let i = 0; i < rest.length; i++) {
    if (rest[i] === '--out') args.out = rest[++i];
    else if (rest[i] === '--approve') args.approved = true;
  }
  if (!file || !args.out) {
    console.error('usage: node templates/judgement-gate/pin.mjs <policy-file> --out <pin.json> [--approve]');
    process.exit(2);
  }
  writeFileSync(args.out, `${JSON.stringify(pinDocument(readFileSync(file), args.approved), null, 2)}\n`);
}
