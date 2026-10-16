#!/usr/bin/env node
// Step 2 (script): count lines and words in a hub-saved docs.get return.
//   node summarise.mjs <folder> --get <hub-saved return or {savedAs} pointer>
// Writes <folder>/out/summary.json. No inference.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';

export function readJson(path) {
  try {
    return JSON.parse(readFileSync(path, 'utf8'));
  } catch {
    throw new Error(`${path}: unreadable`);
  }
}

export function loadSaved(folder, arg) {
  let parsed = readJson(arg);
  if (parsed && typeof parsed.savedAs === 'string' && parsed.savedAs.trim()) {
    const candidates = [parsed.savedAs, resolve(dirname(arg), '..', '..', parsed.savedAs), resolve(folder, parsed.savedAs)];
    const path = candidates.find((candidate) => existsSync(candidate));
    if (!path) throw new Error(`${arg}: pointer target ${parsed.savedAs} not found`);
    parsed = readJson(path);
  }
  const raw = parsed.response ?? parsed;
  if (!raw?.result) throw new Error(`${arg}: not a hub tool return`);
  return raw.result;
}

export function documentText(result) {
  if (typeof result?.contentBase64 !== 'string') throw new Error('docs.get result has no contentBase64');
  const bytes = Buffer.from(result.contentBase64, 'base64');
  const text = bytes.toString('utf8');
  if (!Buffer.from(text).equals(bytes)) throw new Error('document is not UTF-8');
  return text;
}

export function summarise(text) {
  const lineCount = text.split('\n').filter((line) => line.length > 0).length;
  const wordCount = text.split(/\s+/).filter(Boolean).length;
  return { lineCount, wordCount, origin: 'script' };
}

export function writeSummary(folder, result) {
  const summary = summarise(documentText(result));
  mkdirSync(join(folder, 'out'), { recursive: true });
  writeFileSync(join(folder, 'out', 'summary.json'), `${JSON.stringify(summary, null, 2)}\n`);
  return summary;
}

if (process.argv[1] && import.meta.url === `file://${process.argv[1]}`) {
  const [folder, ...rest] = process.argv.slice(2);
  let get;
  for (let i = 0; i < rest.length; i++) if (rest[i] === '--get') get = rest[++i];
  if (!folder || !get) {
    console.error('usage: node summarise.mjs <folder> --get <file or pointer>');
    process.exit(2);
  }
  writeSummary(folder, loadSaved(folder, get));
}
