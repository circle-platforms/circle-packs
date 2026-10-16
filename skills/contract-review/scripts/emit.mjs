#!/usr/bin/env node
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { readJson, sha256 } from './pointers.mjs';

export function emitReview(folder, leftPath, rightPath, policyPath) {
  const gate = readJson(join(folder, 'gate.json'));
  if (gate?.ok !== true || gate.origin !== 'script') throw new Error('gate_not_passed');
  if (sha256(readFileSync(leftPath)) !== gate.leftSha256 || sha256(readFileSync(rightPath)) !== gate.rightSha256) throw new Error('contract_changed_after_gate');
  if (sha256(readFileSync(policyPath)) !== gate.policySha256) throw new Error('policy_changed_after_gate');
  const evidence = [...new Set(gate.clauses.map((clause) => clause.evidenceId).filter(Boolean))];
  const claims = [
    ...gate.unmatched.map((heading) => ({ subject: `contract:${heading}`, predicate: 'unmatched_topic', value: null, origin: 'script', evidenceIds: evidence })),
    ...gate.clauses.filter((clause) => clause.decision !== 'unmatched').map((clause) => ({
      subject: `contract:${clause.heading}`,
      predicate: clause.decision === 'needs_human' ? 'needs_human' : 'clause_risk',
      value: clause.decision === 'scored' ? clause.risk : clause.decision,
      origin: 'script',
      evidenceIds: clause.evidenceId ? [clause.evidenceId] : [],
    })),
  ];
  const lineFor = (clause) => {
    if (clause.decision === 'needs_human') return `Needs human: ${clause.leftKind} vs ${clause.rightKind}. No risk was chosen.\n\nQuote: ${clause.quote}`;
    if (clause.decision === 'unmatched') return `Unmatched topic. No default risk.\n\nQuote: ${clause.quote}`;
    if (clause.decision === 'unruled') return `${clause.kind}: agreed, no pinned rule. Risk is not assigned.\n\nQuote: ${clause.quote}`;
    const quantity = clause.quantity ? ` ${clause.quantity.value} ${clause.quantity.unit}` : '';
    return `${clause.kind}${quantity}\n\nRisk: ${clause.risk} (${clause.ruleId})\n\nQuote: ${clause.quote}`;
  };
  const lines = [
    '# Contract review',
    '',
    'Quotes are checked at their offsets. Risk is a script over the pinned policy, and only where both extracts agree.',
    '',
    ...gate.clauses.map((clause) => `## ${clause.id} ${clause.heading}\n\n${lineFor(clause)}`),
    '',
    '## Unmatched topics',
    '',
    gate.unmatched.length ? gate.unmatched.map((heading) => `- ${heading}: no default risk`).join('\n') : 'None.',
    '',
  ];
  mkdirSync(join(folder, 'out'), { recursive: true });
  writeFileSync(join(folder, 'out', 'clauses.json'), `${JSON.stringify({ clauses: gate.clauses, unmatched: gate.unmatched, needsHuman: gate.needsHuman, origin: 'script' }, null, 2)}\n`);
  writeFileSync(join(folder, 'out', 'review_report.md'), lines.join('\n'));
  writeFileSync(join(folder, 'out', 'review_claims.json'), `${JSON.stringify(claims, null, 2)}\n`);
  return { clauses: gate.clauses, claims };
}

function flags(argv) {
  const args = {};
  for (let i = 0; i < argv.length; i++) if (argv[i].startsWith('--')) args[argv[i].slice(2)] = argv[++i];
  return args;
}

if (process.argv[1] && import.meta.url === `file://${process.argv[1]}`) {
  const [folder, ...rest] = process.argv.slice(2);
  const args = flags(rest);
  if (!folder || !args.left || !args.right || !args.policy) {
    console.error('usage: node emit.mjs <folder> --left <file> --right <file> --policy <file>');
    process.exit(2);
  }
  emitReview(folder, args.left, args.right, args.policy);
}
