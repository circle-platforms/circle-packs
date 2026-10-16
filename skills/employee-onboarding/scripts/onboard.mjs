#!/usr/bin/env node
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';

export const REQUIRED = ['identity', 'equipment', 'accounts', 'policies', 'manager'];
export const STARTER = ['employee-mail', 'employee-directory'];

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
  if (!raw?.result?.lines) throw new Error(`${arg}: docs.section result has no lines`);
  return { text: raw.result.lines.map((line) => line.text).join('\n'), evidenceId: raw.evidence?.[0]?.evidenceId ?? null };
}

export function checklistStatus(completed) {
  const done = new Set(completed);
  return REQUIRED.map((item) => ({ item, status: done.has(item) ? 'done' : 'missing' }));
}
export function reviewAccess(requests) {
  return requests.map((request) => ({ ...request, needsApproval: !STARTER.includes(request.role), origin: 'script' }));
}

export function onboard(folder, checklist, requests, section, answer) {
  if (answer?.origin !== 'model') throw new Error('answer.json must be model judgement');
  if (typeof answer.quote !== 'string' || !answer.quote || !section.text.includes(answer.quote)) throw new Error('policy quote is not in the saved section');
  const items = checklistStatus(checklist.completed ?? checklist);
  const access = reviewAccess(requests.requests ?? requests);
  const markdown = [
    '# Policy answer',
    '',
    'The answer is model judgement. The quote check is a script.',
    '',
    answer.answer,
    '',
    `Quote: ${answer.quote}`,
    section.evidenceId ? `Evidence: ${section.evidenceId}` : 'Evidence: none saved',
    '',
  ].join('\n');
  mkdirSync(join(folder, 'out'), { recursive: true });
  writeFileSync(join(folder, 'out', 'checklist.json'), `${JSON.stringify(items, null, 2)}\n`);
  writeFileSync(join(folder, 'out', 'access_requests.json'), `${JSON.stringify(access, null, 2)}\n`);
  writeFileSync(join(folder, 'out', 'policy_answer.md'), markdown);
  return { items, access };
}

if (process.argv[1] && import.meta.url === `file://${process.argv[1]}`) {
  const [folder, ...rest] = process.argv.slice(2);
  const args = {};
  for (let i = 0; i < rest.length; i++) if (rest[i].startsWith('--')) args[rest[i].slice(2)] = rest[++i];
  if (!folder || !args.checklist || !args.requests || !args.section || !args.answer) {
    console.error('usage: node onboard.mjs <folder> --checklist <file> --requests <file> --section <file> --answer <file>');
    process.exit(2);
  }
  onboard(folder, readJson(args.checklist), readJson(args.requests), loadSaved(folder, args.section), readJson(args.answer));
}
