#!/usr/bin/env node
// Step 4: validate the answer's citations against the hub-saved section returns and render
// answer.md.
//   node cite.mjs <question folder> --section <hub-saved section return or {savedAs} pointer>
//                [--section …] [--search <hub-saved docs.search return or pointer> …] [--answer <file>]
// Reads answer.json (or --answer), validates every citation — the quote must occur verbatim
// in one of the section returns (a single line, or across the lines of a text array) and the
// evidenceId must belong to that return — and checks the answer's own [evd_…] paragraph tags.
// Only then writes answer.md: the model's paragraphs with their tags as written, the
// citations, and a 查询记录 section computed from the --search returns. A validation failure
// is an error and produces no answer.md.
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join, resolve, dirname } from 'node:path';

// Keys whose values are identifiers or locations, never manual text a quote may rest on.
const EXCLUDED_KEYS = new Set(['file', 'path', 'anchor', 'id', 'evidenceId']);

// Collect the text a quote may be matched against: every string value under a
// non-identifier key, plus text arrays (result.lines and friends) joined with newlines so a
// quote may span lines.
function textsOf(value, key = null, into = []) {
  if (value === null || value === undefined) return into;
  const excluded = key !== null && EXCLUDED_KEYS.has(key);
  if (typeof value === 'string') {
    if (!excluded) into.push(value);
  } else if (Array.isArray(value)) {
    const strings = value.filter((item) => typeof item === 'string');
    if (strings.length > 1 && !excluded) into.push(strings.join('\n'));
    for (const item of value) textsOf(item, key, into);
  } else if (typeof value === 'object') {
    for (const [childKey, child] of Object.entries(value)) textsOf(child, childKey, into);
  }
  return into;
}

// Load one --section / --search argument: a hub-saved return {tool, args, at,
// response:{result, evidence}} (older: {result}), or a pointer {"savedAs": "<path>"}
// resolved with the same candidates as apv-case-review's check.mjs: as given, then relative
// to the workspace root (pointer dir /../..), then relative to the question folder.
export function loadReturn(folder, arg) {
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
  if (!raw?.result) throw new Error(`${arg}: not a hub return`);
  return { raw, args: parsed.args ?? {}, name: arg };
}

export function loadSection(folder, arg) {
  const { raw, name } = loadReturn(folder, arg);
  const evidenceIds = (raw.evidence ?? []).map((e) => e.evidenceId).filter((id) => typeof id === 'string');
  return { texts: textsOf(raw.result), evidenceIds, name };
}

// The manual listing of the --list returns: the directory names the docs source actually
// has (rel_apv_<version with underscores>). The chosen version must correspond to one of
// them; a version line that is not a directory on the source is refused, not guessed.
export function manualLog(folder, listArgs, chosenVersion) {
  const directories = [];
  for (const arg of listArgs) {
    const { raw, name } = loadReturn(folder, arg);
    const files = Array.isArray(raw.result.files) ? raw.result.files : [];
    for (const file of files)
      if (file && file.directory && typeof file.path === 'string') {
        const dir = file.path.split('/').filter(Boolean).pop();
        if (dir && !directories.includes(dir)) directories.push(dir);
      }
  }
  if (chosenVersion !== null) {
    if (typeof chosenVersion !== 'string' || !chosenVersion) throw new Error('--chosen-version must be a non-empty version');
    const expected = `rel_apv_${chosenVersion.replaceAll('.', '_')}`;
    if (!directories.includes(expected)) throw new Error(`chosen version ${chosenVersion} has no manual directory: expected ${expected} among ${directories.join(', ') || '(none listed)'}`);
  }
  return { directories, chosen: chosenVersion };
}

// The query log rendered from the --search returns: the searched terms and version from the
// saved args, the hit count from the saved result — never re-typed by the model.
export function searchLog(folder, searchArgs) {
  return searchArgs.map((arg) => {
    const { raw, args, name } = loadReturn(folder, arg);
    const hits = Array.isArray(raw.result.hits) ? raw.result.hits.length : null;
    const terms = [args.query, args.version ?? args.path].filter((v) => typeof v === 'string' && v);
    return { terms, hits, name };
  });
}

const tagOf = (paragraph) => [...paragraph.matchAll(/\[(evd_[^\]\s]+)\]/g)].map((m) => m[1]);

// Validate answer.json against the loaded sections. The model tags each paragraph with the
// evidenceIds it rests on; the script checks every tag resolves to a validated citation.
export function validateAnswer(answer, sections) {
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
    const section = sections.find((s) => s.texts.some((text) => text.includes(citation.quote)));
    if (!section) fail(`citations[${index}]: quote is not in any section return: ${JSON.stringify(citation.quote)}`);
    if (!section.evidenceIds.includes(citation.evidenceId)) fail(`citations[${index}]: evidenceId ${citation.evidenceId} does not belong to the return the quote was found in (${section.name})`);
    // citation.section stays what the model wrote (the manual section name); the saved
    // return's file name rides along as savedReturn and is never rendered.
    return { ...citation, savedReturn: section.name };
  });
  const known = new Set(enriched.map((c) => c.evidenceId));
  answer.answer.split(/\n\s*\n/).map((p) => p.trim()).filter(Boolean).forEach((paragraph, index) => {
    const tags = tagOf(paragraph);
    if (!tags.length) fail(`answer paragraph ${index + 1} carries no [evd_…] tag — every paragraph must name the evidence it rests on`);
    for (const tag of tags) if (!known.has(tag)) fail(`answer paragraph ${index + 1} tags ${tag}, which is not a validated citation`);
  });
  return { status: answer.status, citations: enriched };
}

export function renderAnswer(folder, answer, validated, searches = [], manual = null) {
  const lines = [
    `# ${answer.question}`,
    '',
    '> 回答为模型判断;引用校验与查询记录由脚本生成。',
    '',
  ];
  if (validated.status === 'no_evidence') {
    lines.push(`${answer.answer}`, '');
    lines.push('> 手册里没有找到能回答这个问题的内容;本回答不含任何推断。', '');
  } else {
    answer.answer.split(/\n\s*\n/).map((p) => p.trim()).filter(Boolean).forEach((paragraph) => {
      lines.push(paragraph, '');
    });
    lines.push('## 引用', '');
    for (const citation of validated.citations)
      lines.push(`- ${citation.evidenceId} · ${citation.source ?? ''} · ${citation.section ?? ''}`, `  > ${citation.quote.replace(/\n/g, ' ⏎ ')}`, '');
  }
  if (searches.length || manual) {
    lines.push('## 查询记录', '');
    if (manual) lines.push(`- 手册目录: ${manual.directories.join(', ') || '(none listed)'}${manual.chosen ? ` → 选定 ${manual.chosen}` : ''}`);
    for (const entry of searches)
      lines.push(`- 检索 ${entry.terms.map((t) => `"${t}"`).join(' · ')}${entry.hits === null ? '' : ` · 命中 ${entry.hits}`}`);
    lines.push('');
  }
  writeFileSync(join(folder, 'answer.md'), lines.join('\n') + '\n');
  return join(folder, 'answer.md');
}

export function cite(folder, sectionArgs, searchArgs = [], answerPath = null, listArgs = [], chosenVersion = null) {
  const path = answerPath ?? join(folder, 'answer.json');
  const answer = JSON.parse(readFileSync(path, 'utf8'));
  const sections = sectionArgs.map((arg) => loadSection(folder, arg));
  const validated = validateAnswer(answer, sections);
  const searches = searchLog(folder, searchArgs);
  const manual = listArgs.length || chosenVersion !== null ? manualLog(folder, listArgs, chosenVersion) : null;
  return { rendered: renderAnswer(folder, answer, validated, searches, manual), status: validated.status, citations: validated.citations.length, searches: searches.length };
}

if (process.argv[1] && import.meta.url === `file://${process.argv[1]}`) {
  const [folder, ...rest] = process.argv.slice(2);
  const sections = [], searches = [], lists = [];
  let answer = null, chosenVersion = null;
  for (let i = 0; i < rest.length; i++) {
    if (rest[i] === '--section') sections.push(rest[++i]);
    else if (rest[i] === '--search') searches.push(rest[++i]);
    else if (rest[i] === '--list') lists.push(rest[++i]);
    else if (rest[i] === '--answer') answer = rest[++i];
    else if (rest[i] === '--chosen-version') chosenVersion = rest[++i];
  }
  if (!folder || !sections.length) {
    console.error('usage: node cite.mjs <question folder> --section <file or pointer> [--section …] [--search <file or pointer> …] [--list <file or pointer> …] [--chosen-version <version>] [--answer <answer.json>]');
    process.exit(2);
  }
  const result = cite(folder, sections, searches, answer, lists, chosenVersion);
  console.log(JSON.stringify({ status: result.status, citations: result.citations, searches: result.searches, rendered: result.rendered }));
}
