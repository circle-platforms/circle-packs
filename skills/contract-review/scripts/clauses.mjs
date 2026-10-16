#!/usr/bin/env node
// Clause split is a script. Risk notes are read from the model's review.json and not rewritten.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';

const REQUIRED = ['Payment terms', 'Termination', 'Liability', 'Data protection'];

function readJson(path) {
  try { return JSON.parse(readFileSync(path, 'utf8')); }
  catch { throw new Error(`${path}: unreadable`); }
}

function loadSaved(folder, arg) {
  let parsed = readJson(arg);
  if (parsed && typeof parsed.savedAs === 'string' && parsed.savedAs.trim()) {
    const path = [parsed.savedAs, resolve(dirname(arg), '..', '..', parsed.savedAs), resolve(folder, parsed.savedAs)].find((candidate) => existsSync(candidate));
    if (!path) throw new Error(`${arg}: pointer target ${parsed.savedAs} not found`);
    parsed = readJson(path);
  }
  const raw = parsed.response ?? parsed;
  if (!raw?.result) throw new Error(`${arg}: not a hub tool return`);
  return { result: raw.result, evidenceId: raw.evidence?.[0]?.evidenceId ?? null };
}

export function documentText(result) {
  if (typeof result?.contentBase64 !== 'string') throw new Error('docs.get result has no contentBase64');
  const bytes = Buffer.from(result.contentBase64, 'base64');
  const text = bytes.toString('utf8');
  if (!Buffer.from(text).equals(bytes)) throw new Error('document is not UTF-8');
  return text;
}

export function extractClauses(text) {
  const lines = text.split('\n');
  const headings = [];
  for (let i = 0; i < lines.length; i++) {
    const match = /^(?:#{1,3} |\d+\. )(.+?)\s*$/.exec(lines[i]);
    if (match) headings.push({ index: i, heading: match[1] });
  }
  const clauses = headings.map((heading, index) => ({
    id: `c${index + 1}`,
    heading: heading.heading,
    text: lines.slice(heading.index + 1, headings[index + 1]?.index ?? lines.length).join('\n').trim(),
  }));
  const present = new Set(clauses.map((clause) => clause.heading));
  return { clauses, gaps: REQUIRED.filter((heading) => !present.has(heading)) };
}

export function reviewContract(folder, saved, review) {
  if (review?.origin !== 'model' || !Array.isArray(review.findings)) throw new Error('review.json must be model judgement with findings[]');
  const { result, evidenceId } = saved;
  const { clauses, gaps } = extractClauses(documentText(result));
  const subject = `contract:${typeof result.path === 'string' ? result.path : 'uploaded'}`;
  const claims = gaps.map((heading) => ({ subject, predicate: 'missing_clause', value: heading, origin: 'script', evidenceIds: evidenceId ? [evidenceId] : [] }));
  const report = [
    '# Contract review',
    '',
    'Clause splits and missing headings are a script. Risk notes are model judgement.',
    '',
    ...clauses.map((clause) => `## ${clause.id} ${clause.heading}\n\n${clause.text}`),
    '',
    '## Missing headings (script)',
    '',
    gaps.length ? gaps.map((gap) => `- ${gap}`).join('\n') : 'None.',
    '',
    '## Risk notes (model)',
    '',
    ...review.findings.map((finding) => `- ${finding.clauseId}: ${finding.risk} — ${finding.note}`),
    '',
  ].join('\n');
  mkdirSync(join(folder, 'out'), { recursive: true });
  writeFileSync(join(folder, 'out', 'clauses.json'), `${JSON.stringify({ clauses, gaps, origin: 'script' }, null, 2)}\n`);
  writeFileSync(join(folder, 'out', 'review_report.md'), report);
  writeFileSync(join(folder, 'out', 'review_claims.json'), `${JSON.stringify(claims, null, 2)}\n`);
  return { clauses, gaps, claims };
}

if (process.argv[1] && import.meta.url === `file://${process.argv[1]}`) {
  const [folder, ...rest] = process.argv.slice(2);
  let get, reviewPath;
  for (let i = 0; i < rest.length; i++) {
    if (rest[i] === '--get') get = rest[++i];
    else if (rest[i] === '--review') reviewPath = rest[++i];
  }
  if (!folder || !get || !reviewPath) {
    console.error('usage: node clauses.mjs <folder> --get <file> --review <review.json>');
    process.exit(2);
  }
  reviewContract(folder, loadSaved(folder, get), readJson(reviewPath));
}
