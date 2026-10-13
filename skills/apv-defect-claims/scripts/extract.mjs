#!/usr/bin/env node
// Step 3: extract candidate claims from hub-saved zentao.bug_detail returns.
//   node extract.mjs <folder> --detail <hub-saved return or {savedAs} pointer> [--detail …]
// The claim logic is a plain-JS copy of products/apv/tools/defect-claims.ts in the
// circle-packs repo (keep the two in sync; that file is the product-line Tool, this one
// keeps the skill self-contained — no cross-directory imports). Writes <folder>/defect_claims.json.
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join, resolve, dirname } from 'node:path';

// Field-to-predicate table and helpers, mirrored from products/apv/tools/defect-claims.ts.
const FIELD_PREDICATES = [
  ['title', 'title'],
  ['state', 'status'],
  ['severity', 'severity'],
  ['priority', 'priority'],
  ['product', 'affects_product'],
  ['openedBuild', 'affects_version'],
  ['resolvedBuild', 'fixed_in_build'],
  ['resolution', 'resolution'],
];
const present = (value) => {
  if (value === null || value === undefined) return false;
  if (typeof value === 'string') return value.trim() !== '' && value !== '0'; // ZenTao writes "0" for "none"
  if (typeof value === 'object') return Object.keys(value).length > 0;
  return true;
};

export function extractDefectClaims(result, evidenceId) {
  const items = result?.items;
  if (!Array.isArray(items)) throw new Error('not a zentao.bug_detail result: items[] is required');
  if (evidenceId !== null && (typeof evidenceId !== 'string' || !evidenceId)) throw new Error('evidenceId must be a non-empty string or null');
  const claims = [];
  for (const item of items) {
    if (!item || typeof item !== 'object') continue;
    const id = String(item.id ?? '');
    if (!id) continue;
    const subject = `defect:${id}`;
    for (const [field, predicate] of FIELD_PREDICATES)
      if (present(item[field])) claims.push({ subject, predicate, value: item[field], origin: 'script', evidenceIds: evidenceId ? [evidenceId] : [] });
    if (present(item.legacyIssueId)) claims.push({ subject, predicate: 'legacy_issue_id', value: item.legacyIssueId, origin: 'script', evidenceIds: evidenceId ? [evidenceId] : [] });
    for (const action of Array.isArray(item.actions) ? item.actions : [])
      if (action && typeof action === 'object' && action.action === 'svncommited' && present(action.comment))
        claims.push({ subject, predicate: 'repair_note', value: { date: action.date, actor: action.actor, comment: action.comment }, origin: 'script', evidenceIds: evidenceId ? [evidenceId] : [] });
  }
  return claims;
}

// Load one --detail argument: a hub-saved return {tool, args, at, response:{result,
// evidence}} (older: {result}), or a pointer {"savedAs": "<path>"} resolved with the same
// candidates as the other APV skills: as given, then relative to the workspace root
// (pointer dir /../..), then relative to the folder.
export function loadDetail(folder, arg) {
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
  if (!raw?.result || !Array.isArray(raw.result.items)) throw new Error(`${arg}: not a zentao.bug_detail return`);
  return { result: raw.result, evidenceId: raw.evidence?.[0]?.evidenceId ?? null };
}

export function extract(folder, detailArgs) {
  const claims = [];
  for (const arg of detailArgs) {
    const { result, evidenceId } = loadDetail(folder, arg);
    claims.push(...extractDefectClaims(result, evidenceId));
  }
  writeFileSync(join(folder, 'defect_claims.json'), JSON.stringify(claims, null, 2) + '\n');
  return claims;
}

if (process.argv[1] && import.meta.url === `file://${process.argv[1]}`) {
  const [folder, ...rest] = process.argv.slice(2);
  const details = [];
  for (let i = 0; i < rest.length; i++) if (rest[i] === '--detail') details.push(rest[++i]);
  if (!folder || !details.length) { console.error('usage: node extract.mjs <folder> --detail <file or pointer> [--detail …]'); process.exit(2); }
  const claims = extract(folder, details);
  console.log(JSON.stringify({ claims: claims.length, subjects: [...new Set(claims.map((c) => c.subject))].length }));
}
