#!/usr/bin/env node
import { readFileSync, writeFileSync } from 'node:fs';
import { assertExactKeys, assertOriginModel, assertPointer, assertVerbatim, loadPointedReturn, readJson, sha256, utf8FromBase64 } from './pointers.mjs';

const CLAUSE_KEYS = ['effect', 'heading', 'id', 'quote', 'source', 'value'];

export function headingsOf(text) {
  const lines = text.split('\n');
  const found = [];
  for (let i = 0; i < lines.length; i++) {
    const match = /^(?:#{1,3} |\d+\. )(.+?)\s*$/.exec(lines[i]);
    if (match) found.push({ index: i, heading: match[1] });
  }
  return found.map((heading, index) => ({
    heading: heading.heading,
    section: [lines[heading.index], ...lines.slice(heading.index + 1, found[index + 1]?.index ?? lines.length)].join('\n'),
  }));
}

export function scoreClause(clause, policy) {
  const rules = policy.rules.filter((rule) => rule.heading === clause.heading && rule.effect === clause.effect);
  for (const rule of rules) {
    if (!rule.valuePattern || new RegExp(rule.valuePattern).test(clause.value)) return { risk: rule.risk, ruleId: rule.id };
  }
  return { risk: policy.defaultRisk, ruleId: null };
}

export function gateClauses(folder, contractPath, policyPath) {
  const bytes = readFileSync(contractPath);
  const contract = readJson(contractPath);
  const policy = readJson(policyPath);
  assertExactKeys(contract, ['clauses', 'origin', 'schema', 'source'], 'contract');
  assertOriginModel(contract, 'contract');
  if (contract.schema !== 'enterprise/clauses/1' || !Array.isArray(contract.clauses)) throw new Error('schema_invalid: clauses');
  if (policy.schema !== 'enterprise/risk-policy/1' || !Array.isArray(policy.required) || !Array.isArray(policy.rules)) throw new Error('schema_invalid: policy');
  const saved = loadPointedReturn(folder, contract.source, 'contract source');
  const text = utf8FromBase64(saved.result);
  const headings = headingsOf(text);
  const clauses = contract.clauses.map((clause, index) => {
    assertExactKeys(clause, CLAUSE_KEYS, `clause ${index}`);
    if (!['permit', 'forbid'].includes(clause.effect)) throw new Error(`schema_invalid: clause ${index} effect`);
    if (typeof clause.id !== 'string' || typeof clause.heading !== 'string' || typeof clause.value !== 'string') throw new Error(`schema_invalid: clause ${index}`);
    assertPointer(clause.source, `clause ${index} source`);
    if (clause.source.savedAs !== saved.savedAs) throw new Error(`pointer_not_transcribe: clause ${index} source differs from the contract source`);
    const section = headings.find((item) => item.heading === clause.heading);
    if (!section) throw new Error(`quote_not_verbatim: ${clause.id} heading is not in the source`);
    assertVerbatim(clause.quote, section.section, clause.id);
    if (!clause.quote.includes(clause.value)) throw new Error(`quote_not_verbatim: ${clause.id} value is not inside the quote`);
    const score = scoreClause(clause, policy);
    return { id: clause.id, heading: clause.heading, effect: clause.effect, value: clause.value, quote: clause.quote, risk: score.risk, ruleId: score.ruleId, evidenceId: saved.evidenceId, savedAs: saved.savedAs };
  });
  const present = new Set(headings.map((item) => item.heading));
  const extracted = new Set(clauses.map((clause) => clause.heading));
  const absent = policy.required.filter((heading) => !present.has(heading));
  const unextracted = policy.required.filter((heading) => present.has(heading) && !extracted.has(heading));
  const missingRule = policy.rules.find((rule) => rule.effect === 'missing');
  const gate = {
    ok: true,
    origin: 'script',
    contractSha256: sha256(bytes),
    clauses,
    absent,
    unextracted,
    missingRisk: missingRule?.risk ?? policy.defaultRisk,
    missingRuleId: missingRule?.id ?? null,
  };
  writeFileSync(`${folder}/gate.json`, `${JSON.stringify(gate, null, 2)}\n`);
  return gate;
}

if (process.argv[1] && import.meta.url === `file://${process.argv[1]}`) {
  const [folder, ...rest] = process.argv.slice(2);
  const args = {};
  for (let i = 0; i < rest.length; i++) if (rest[i].startsWith('--')) args[rest[i].slice(2)] = rest[++i];
  if (!folder || !args.contract || !args.policy) {
    console.error('usage: node gate.mjs <folder> --contract <file> --policy <file>');
    process.exit(2);
  }
  gateClauses(folder, args.contract, args.policy);
}
