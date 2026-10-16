#!/usr/bin/env node
import { readFileSync, writeFileSync } from 'node:fs';
import { assertCovered, assertExactKeys, assertOriginModel, assertPointer, assertPolarity, assertVerbatim, loadOriginal, readJson, sha256 } from './pointers.mjs';

const CLAUSE_KEYS = ['cue', 'effect', 'heading', 'id', 'quote', 'source', 'value'];
const HEADING = /^(?:#{1,6}[ \t]+|\d+[.、][ \t]*|第[0-9０-９一二三四五六七八九十百零]+条[ \t]*)(.+?)\s*$/;

export function headingsOf(text) {
  const lines = text.split(/\r?\n/);
  const found = [];
  for (let i = 0; i < lines.length; i++) {
    const match = HEADING.exec(lines[i].trim());
    if (match) found.push({ index: i, heading: match[1].trim() });
  }
  return found.map((heading, index) => ({
    heading: heading.heading,
    section: [lines[heading.index], ...lines.slice(heading.index + 1, found[index + 1]?.index ?? lines.length)].join('\n'),
  }));
}

export function dayCount(value) {
  const match = /(\d+)\s*(?:days|日|天)/i.exec(value);
  return match ? Number(match[1]) : null;
}

export function topicOf(heading, policy) {
  return policy.required.find((topic) => topic.headings.some((name) => heading === name || heading.includes(name)))?.id ?? null;
}

export function scoreClause(clause, policy) {
  const topic = topicOf(clause.heading, policy);
  const rules = policy.rules.filter((rule) => rule.topic === topic && rule.effect === clause.effect);
  const days = dayCount(clause.value);
  for (const rule of rules) {
    if (rule.maxDays != null && (days == null || days > rule.maxDays)) continue;
    if (rule.minDays != null && (days == null || days < rule.minDays)) continue;
    if (rule.valuePattern && !new RegExp(rule.valuePattern).test(clause.value)) continue;
    return { risk: rule.risk, ruleId: rule.id, topic };
  }
  return { risk: policy.defaultRisk, ruleId: null, topic };
}

export function gateClauses(folder, contractPath, policyPath) {
  const bytes = readFileSync(contractPath);
  const policyBytes = readFileSync(policyPath);
  const contract = readJson(contractPath);
  const policy = readJson(policyPath);
  assertExactKeys(contract, ['clauses', 'origin', 'schema', 'source'], 'contract');
  assertOriginModel(contract, 'contract');
  if (contract.schema !== 'enterprise/clauses/1' || !Array.isArray(contract.clauses)) throw new Error('schema_invalid: clauses');
  if (policy.schema !== 'enterprise/risk-policy/1' || !Array.isArray(policy.required) || !Array.isArray(policy.rules)) throw new Error('schema_invalid: policy');
  const saved = loadOriginal(folder, contract.source, 'contract source');
  const headings = headingsOf(saved.text);
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
    assertPolarity(clause.quote, clause.cue, clause.effect, clause.id);
    const score = scoreClause(clause, policy);
    return { id: clause.id, heading: clause.heading, effect: clause.effect, value: clause.value, cue: clause.cue, quote: clause.quote, risk: score.risk, ruleId: score.ruleId, topic: score.topic, evidenceId: saved.evidenceId, savedAs: saved.savedAs };
  });
  assertCovered(headings.map((item) => item.heading), clauses.map((clause) => clause.heading), 'clauses');
  const present = new Set(clauses.map((clause) => clause.topic).filter(Boolean));
  const absent = policy.required.filter((topic) => !present.has(topic.id)).map((topic) => topic.id);
  const missingRule = policy.rules.find((rule) => rule.effect === 'missing');
  const gate = {
    ok: true,
    origin: 'script',
    contractSha256: sha256(bytes),
    policySha256: sha256(policyBytes),
    clauses,
    absent,
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
