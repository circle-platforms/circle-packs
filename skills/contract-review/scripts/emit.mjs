#!/usr/bin/env node
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { readJson, sha256 } from './pointers.mjs';

export function emitReview(folder, contractPath, policyPath) {
  const gate = readJson(join(folder, 'gate.json'));
  if (gate?.ok !== true || gate.origin !== 'script') throw new Error('gate_not_passed');
  if (sha256(readFileSync(contractPath)) !== gate.contractSha256) throw new Error('contract_changed_after_gate');
  if (policyPath && sha256(readFileSync(policyPath)) !== gate.policySha256) throw new Error('contract_changed_after_gate');
  const evidence = [...new Set(gate.clauses.map((clause) => clause.evidenceId).filter(Boolean))];
  const claims = [
    ...gate.absent.map((heading) => ({ subject: 'contract:source', predicate: 'missing_clause', value: heading, origin: 'script', evidenceIds: evidence })),
    ...gate.clauses.map((clause) => ({ subject: `contract:${clause.heading}`, predicate: 'clause_risk', value: clause.risk, origin: 'script', evidenceIds: clause.evidenceId ? [clause.evidenceId] : [] })),
  ];
  const lines = [
    '# Contract review',
    '',
    'Quotes are model judgement checked verbatim. Risk is a script over the policy table.',
    '',
    ...gate.clauses.map((clause) => `## ${clause.id} ${clause.heading}\n\n${clause.effect}: ${clause.value}\n\nRisk: ${clause.risk} (${clause.ruleId ?? 'default'})\n\nQuote: ${clause.quote}`),
    '',
    '## Missing from the source (script)',
    '',
    gate.absent.length ? gate.absent.map((heading) => `- ${heading}: ${gate.missingRisk}`).join('\n') : 'None.',
    '',
  ];
  mkdirSync(join(folder, 'out'), { recursive: true });
  writeFileSync(join(folder, 'out', 'clauses.json'), `${JSON.stringify({ clauses: gate.clauses, absent: gate.absent, origin: 'script' }, null, 2)}\n`);
  writeFileSync(join(folder, 'out', 'review_report.md'), lines.join('\n'));
  writeFileSync(join(folder, 'out', 'review_claims.json'), `${JSON.stringify(claims, null, 2)}\n`);
  return { clauses: gate.clauses, claims };
}

if (process.argv[1] && import.meta.url === `file://${process.argv[1]}`) {
  const [folder, ...rest] = process.argv.slice(2);
  const args = {};
  for (let i = 0; i < rest.length; i++) if (rest[i].startsWith('--')) args[rest[i].slice(2)] = rest[++i];
  if (!folder || !args.contract || !args.policy) {
    console.error('usage: node emit.mjs <folder> --contract <file> --policy <file>');
    process.exit(2);
  }
  emitReview(folder, args.contract, args.policy);
}
