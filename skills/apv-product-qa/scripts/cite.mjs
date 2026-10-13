#!/usr/bin/env node
// Step 4: validate the answer's citations against the hub-saved section returns and render
// answer.md.
//   node cite.mjs <batch folder> --section <hub-saved section return or {savedAs} pointer> [--section …]
// Reads <batch>/answer.json (or --answer), validates every citation — the quote must occur
// verbatim in one of the section returns and the evidenceId must belong to that return —
// and only then writes <batch>/answer.md: every paragraph tagged [evd_…], citations listed
// at the end. A validation failure is an error and produces no answer.md.
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join, resolve, dirname } from 'node:path';

// Collect every string value of a structure, so a quote can be matched against whatever
// field the section return carries its text in.
function stringsOf(value, into = []) {
  if (typeof value === 'string') into.push(value);
  else if (Array.isArray(value)) for (const item of value) stringsOf(item, into);
  else if (value && typeof value === 'object') for (const item of Object.values(value)) stringsOf(item, into);
  return into;
}

// Load one --section argument: a hub-saved return {tool, args, at, response:{result,
// evidence}} (older: {result}), or a pointer {"savedAs": "<path>"} resolved with the same
// candidates as apv-case-review's check.mjs: as given, then relative to the workspace root
// (pointer dir /../..), then relative to the batch folder.
export function loadSection(folder, arg) {
  let parsed;
  try { parsed = JSON.parse(readFileSync(arg, 'utf8')); }
  catch { throw new Error(`${arg}: unreadable`); }
  if (parsed && typeof parsed.savedAs === 'string' && parsed.savedAs.trim()) {
    const candidates = [parsed.savedAs, resolve(dirname(arg), '..', '..', parsed.savedAs), resolve(folder, parsed.savedAs)];
    const path = candidates.find((p) => existsSync(p));
    if (!path) throw new Error(`${arg}: pointer target ${parsed.savedAs} not found`);
    parsed = JSON.parse(readFileSync(path, 'utf8'));
  }
  const raw = parsed.response ?? parsed;
  if (!raw?.result) throw new Error(`${arg}: not a section return`);
  const evidenceIds = (raw.evidence ?? []).map((e) => e.evidenceId).filter((id) => typeof id === 'string');
  return { strings: stringsOf(raw.result), evidenceIds, name: arg };
}

// Validate answer.json against the loaded sections. Returns the citations enriched with the
// matching return, or throws with the first problem.
export function validateAnswer(answer, sections) {
  const problems = [];
  const fail = (message) => { throw new Error(message); };
  if (!answer || typeof answer !== 'object') fail('answer.json: not an object');
  if (typeof answer.question !== 'string' || !answer.question.trim()) fail('answer.json: question is required');
  if (answer.status !== 'answered' && answer.status !== 'no_evidence') fail(`answer.json: status must be answered or no_evidence, not ${JSON.stringify(answer.status)}`);
  if (typeof answer.answer !== 'string' || !answer.answer.trim()) fail('answer.json: answer is required');
  const citations = Array.isArray(answer.citations) ? answer.citations : [];
  if (answer.status === 'no_evidence') {
    if (citations.length) fail('answer.json: no_evidence must carry no citations');
    return { status: answer.status, citations: [] };
  }
  if (!citations.length) fail('answer.json: answered needs at least one citation');
  const enriched = citations.map((citation, index) => {
    if (!citation || typeof citation.quote !== 'string' || !citation.quote.trim()) fail(`citations[${index}]: quote is required`);
    if (typeof citation.evidenceId !== 'string' || !/^evd_/.test(citation.evidenceId)) fail(`citations[${index}]: evidenceId is required`);
    const section = sections.find((s) => s.strings.some((text) => text.includes(citation.quote)));
    if (!section) fail(`citations[${index}]: quote is not in any section return: ${JSON.stringify(citation.quote)}`);
    if (!section.evidenceIds.includes(citation.evidenceId)) fail(`citations[${index}]: evidenceId ${citation.evidenceId} does not belong to the return the quote was found in (${section.name})`);
    return { ...citation, section: section.name };
  });
  const paragraphs = answer.answer.split(/\n\s*\n/).map((p) => p.trim()).filter(Boolean);
  paragraphs.forEach((paragraph, index) => {
    const backing = enriched.filter((c) => paragraph.includes(c.quote));
    if (!backing.length) fail(`answer paragraph ${index + 1} carries no citation quote — every paragraph must contain the quote it rests on`);
  });
  return { status: answer.status, citations: enriched, paragraphs };
}

export function renderAnswer(folder, answer, validated) {
  const lines = [`# ${answer.question}`, ''];
  if (validated.status === 'no_evidence') {
    lines.push(`${answer.answer}`, '');
    lines.push('> 手册里没有找到能回答这个问题的内容;本回答不含任何推断。', '');
    writeFileSync(join(folder, 'answer.md'), lines.join('\n') + '\n');
    return join(folder, 'answer.md');
  }
  answer.answer.split(/\n\s*\n/).map((p) => p.trim()).filter(Boolean).forEach((paragraph) => {
    const tags = validated.citations.filter((c) => paragraph.includes(c.quote)).map((c) => c.evidenceId);
    lines.push(`${paragraph} ${tags.map((id) => `[${id}]`).join(' ')}`, '');
  });
  lines.push('## 引用', '');
  for (const citation of validated.citations)
    lines.push(`- ${citation.evidenceId} · ${citation.source ?? citation.section} · ${citation.section ?? ''}`, `  > ${citation.quote}`, '');
  writeFileSync(join(folder, 'answer.md'), lines.join('\n') + '\n');
  return join(folder, 'answer.md');
}

export function cite(folder, sectionArgs, answerPath = null) {
  const path = answerPath ?? join(folder, 'answer.json');
  const answer = JSON.parse(readFileSync(path, 'utf8'));
  const sections = sectionArgs.map((arg) => loadSection(folder, arg));
  const validated = validateAnswer(answer, sections);
  return { rendered: renderAnswer(folder, answer, validated), status: validated.status, citations: validated.citations.length };
}

if (process.argv[1] && import.meta.url === `file://${process.argv[1]}`) {
  const [folder, ...rest] = process.argv.slice(2);
  const sections = [];
  let answer = null;
  for (let i = 0; i < rest.length; i++) {
    if (rest[i] === '--section') sections.push(rest[++i]);
    else if (rest[i] === '--answer') answer = rest[++i];
  }
  if (!folder || !sections.length) {
    console.error('usage: node cite.mjs <batch folder> --section <file or pointer> [--section …] [--answer <answer.json>]');
    process.exit(2);
  }
  const result = cite(folder, sections, answer);
  console.log(JSON.stringify({ status: result.status, citations: result.citations, rendered: result.rendered }));
}
