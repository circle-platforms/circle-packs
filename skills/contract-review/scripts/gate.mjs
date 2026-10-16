#!/usr/bin/env node
import { readFileSync, writeFileSync } from 'node:fs';
import { assertAdjacent, assertCovered, assertExactKeys, assertKeys, assertOriginModel, assertPolicyPin, assertQuoteAt, GateError, loadOriginal, parseQuantity, readJson, sha256 } from './pointers.mjs';

const KINDS = ['permit', 'forbid', 'obligation', 'term', 'definition'];
const ARTICLE = /^(第[0-9０-９一二三四五六七八九十百零]+条)(?:[ \t]+(.*))?$/;

export function splitHeadingLine(line) {
  const trimmed = line.trim();
  const article = ARTICLE.exec(trimmed);
  if (article) {
    const marker = article[1];
    const rest = (article[2] ?? '').trim();
    if (!rest) return { heading: marker, inline: '' };
    const colon = /[：:]/.exec(rest);
    if (colon && colon.index > 0 && colon.index <= 12) {
      const title = rest.slice(0, colon.index).trim();
      if (title.length >= 1 && title.length <= 12 && !/[。！？]/.test(title)) return { heading: title, inline: rest.slice(colon.index + 1).trim() };
    }
    if (/^[\u3400-\u9fffA-Za-z0-9 ]{1,12}$/.test(rest)) return { heading: rest, inline: '' };
    return { heading: marker, inline: rest };
  }
  const markdown = /^(?:#{1,6}[ \t]+|\d+[.、][ \t]*)(.+)$/.exec(trimmed);
  if (markdown) return { heading: markdown[1].trim(), inline: '' };
  return null;
}

export function headingsOf(text) {
  const lines = text.split(/\r?\n/);
  const marks = [];
  for (let i = 0; i < lines.length; i++) {
    const split = splitHeadingLine(lines[i]);
    if (split) marks.push({ index: i, ...split });
  }
  return marks.map((mark, index) => {
    const next = marks[index + 1]?.index ?? lines.length;
    const following = lines.slice(mark.index + 1, next);
    const section = [lines[mark.index], ...following].join('\n');
    return { heading: mark.heading, section };
  });
}

export function topicOf(heading, quote, policy) {
  const exact = policy.topics.find((topic) => topic.headings.some((name) => heading === name));
  if (exact) return exact.id;
  if (!/^第.+条$/.test(heading)) return null;
  const hits = [];
  for (const topic of policy.topics) {
    for (const name of topic.headings) if (name && quote.includes(name)) hits.push({ id: topic.id, name });
  }
  hits.sort((a, b) => b.name.length - a.name.length || (a.id < b.id ? -1 : 1));
  if (!hits.length) return null;
  const longest = hits[0].name.length;
  const ids = new Set(hits.filter((hit) => hit.name.length === longest).map((hit) => hit.id));
  return ids.size === 1 ? [...ids][0] : null;
}

function readExtract(path) {
  const bytes = readFileSync(path);
  const contract = readJson(path);
  assertExactKeys(contract, ['clauses', 'origin', 'schema', 'source'], path);
  assertOriginModel(contract, path);
  if (contract.schema !== 'enterprise/clauses/2' || !Array.isArray(contract.clauses)) throw new GateError('schema_invalid', `${path} clauses`);
  return { bytes, contract };
}

function indexClauses(contract, saved, headings, label) {
  const byHeading = new Map();
  contract.clauses.forEach((clause, index) => {
    const name = `${label} ${index}`;
    assertKeys(clause, ['heading', 'id', 'kind', 'offset', 'quote'], ['cue', 'predicate', 'value'], name);
    if (typeof clause.id !== 'string' || typeof clause.heading !== 'string') throw new GateError('schema_invalid', name);
    if (!KINDS.includes(clause.kind)) throw new GateError('schema_invalid', `${name} kind`);
    assertQuoteAt(saved.text, clause.quote, clause.offset, clause.id);
    const section = headings.find((item) => item.heading === clause.heading);
    if (!section || !section.section.includes(clause.quote)) throw new GateError('quote_not_verbatim', `${clause.id} heading`);
    if (clause.value != null && !clause.quote.includes(clause.value)) throw new GateError('quote_not_verbatim', `${clause.id} value`);
    if (clause.cue != null) {
      if (typeof clause.predicate !== 'string') throw new GateError('schema_invalid', `${name} predicate`);
      assertAdjacent(clause.quote, clause.cue, clause.predicate, clause.id);
    }
    if (byHeading.has(clause.heading)) throw new GateError('schema_invalid', `${label} duplicate heading ${clause.heading}`);
    byHeading.set(clause.heading, clause);
  });
  assertCovered(headings.map((item) => item.heading), [...byHeading.keys()], label);
  return byHeading;
}

function quantityOf(clause) {
  if (clause.kind !== 'term') return null;
  if (typeof clause.value !== 'string') throw new GateError('schema_invalid', `${clause.id} term value`);
  const quantity = parseQuantity(clause.value);
  if (!quantity) throw new GateError('schema_invalid', `${clause.id} term value does not parse`);
  return { value: quantity.value, unit: quantity.unit };
}

export function scoreAgreed(clause, quantity, policy) {
  const topic = topicOf(clause.heading, clause.quote, policy);
  if (!topic) return { decision: 'unmatched', risk: null, ruleId: null, topic: null, quantity };
  for (const rule of policy.rules) {
    if (rule.topic !== topic || rule.kind !== clause.kind) continue;
    if (rule.minDays != null) {
      if (!quantity || quantity.unit !== 'day' || rule.unit !== 'day') continue;
      const risk = quantity.value < rule.minDays ? rule.belowRisk : rule.metRisk;
      return { decision: 'scored', risk, ruleId: rule.id, topic, quantity };
    }
    if (typeof rule.risk === 'string') return { decision: 'scored', risk: rule.risk, ruleId: rule.id, topic, quantity };
  }
  return { decision: 'unruled', risk: null, ruleId: null, topic, quantity };
}

export function gateClauses(folder, leftPath, rightPath, policyPath, pinPath) {
  const left = readExtract(leftPath);
  const right = readExtract(rightPath);
  const policyBytes = readFileSync(policyPath);
  const policy = readJson(policyPath);
  assertPolicyPin(policyBytes, readJson(pinPath));
  if (policy.schema !== 'enterprise/risk-policy/2' || !Array.isArray(policy.topics) || !Array.isArray(policy.rules)) throw new GateError('schema_invalid', 'policy');
  if (policy.defaultRisk != null) throw new GateError('schema_invalid', 'policy has no default risk');
  const saved = loadOriginal(folder, left.contract.source, 'contract source');
  if (right.contract.source.savedAs !== saved.savedAs) throw new GateError('pointer_not_transcribe', 'extracts name different sources');
  const headings = headingsOf(saved.text);
  const leftBy = indexClauses(left.contract, saved, headings, 'left');
  const rightBy = indexClauses(right.contract, saved, headings, 'right');
  const clauses = headings.map((section) => {
    const one = leftBy.get(section.heading);
    const two = rightBy.get(section.heading);
    const leftQuantity = quantityOf(one);
    const rightQuantity = quantityOf(two);
    const base = { id: one.id, heading: section.heading, quote: one.quote, evidenceId: saved.evidenceId, savedAs: saved.savedAs };
    if (one.kind !== two.kind || JSON.stringify(leftQuantity) !== JSON.stringify(rightQuantity)) {
      return { ...base, kind: null, leftKind: one.kind, rightKind: two.kind, decision: 'needs_human', risk: null, ruleId: null, topic: topicOf(section.heading, one.quote, policy), quantity: null };
    }
    const scored = scoreAgreed(one, leftQuantity, policy);
    return { ...base, kind: one.kind, leftKind: one.kind, rightKind: two.kind, ...scored };
  });
  const unmatched = clauses.filter((clause) => clause.decision === 'unmatched').map((clause) => clause.heading);
  const gate = {
    ok: true,
    needsHuman: clauses.some((clause) => clause.decision === 'needs_human'),
    origin: 'script',
    leftSha256: sha256(left.bytes),
    rightSha256: sha256(right.bytes),
    policySha256: sha256(policyBytes),
    clauses,
    unmatched,
  };
  writeFileSync(`${folder}/gate.json`, `${JSON.stringify(gate, null, 2)}\n`);
  return gate;
}

function flags(argv) {
  const args = {};
  for (let i = 0; i < argv.length; i++) if (argv[i].startsWith('--')) args[argv[i].slice(2)] = argv[++i];
  return args;
}

if (process.argv[1] && import.meta.url === `file://${process.argv[1]}`) {
  const [folder, ...rest] = process.argv.slice(2);
  const args = flags(rest);
  if (!folder || !args.left || !args.right || !args.policy || !args.pin) {
    console.error('usage: node gate.mjs <folder> --left <file> --right <file> --policy <file> --pin <file>');
    process.exit(2);
  }
  gateClauses(folder, args.left, args.right, args.policy, args.pin);
}
