// Gate primitives for the judgement/code split. The generator copies this file into a skill.
// A skill does not import the template. Node built-ins are fine here: this runs as a local
// script, not as a frozen hub tool.
import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';

export class GateError extends Error {
  constructor(code, detail) {
    super(`${code}: ${detail}`);
    this.code = code;
    this.detail = detail;
  }
}

export const sha256 = (bytes) => createHash('sha256').update(bytes).digest('hex');

export function readJson(path) {
  try {
    return JSON.parse(readFileSync(path, 'utf8'));
  } catch {
    throw new GateError('schema_invalid', `${path}: unreadable`);
  }
}

export function assertExactKeys(value, keys, label) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new GateError('schema_invalid', `${label} is not an object`);
  const got = Object.keys(value).sort().join();
  const want = [...keys].sort().join();
  if (got !== want) throw new GateError('schema_invalid', `${label} keys must be ${[...keys].sort().join(', ')}`);
}

export function assertPointer(value, label) {
  if (!value || typeof value !== 'object' || Array.isArray(value) || Object.keys(value).length !== 1 || typeof value.savedAs !== 'string' || !value.savedAs.trim())
    throw new GateError('pointer_not_transcribe', `${label} must be exactly {"savedAs":"<path>"}`);
  const parts = value.savedAs.split('/');
  if (value.savedAs.startsWith('/') || parts.some((part) => part === '' || part === '.' || part === '..'))
    throw new GateError('pointer_not_transcribe', `${label} path is not a safe relative path`);
  return value.savedAs;
}

export function resolveSaved(folder, pointerFile, savedAs) {
  const candidates = [savedAs, resolve(dirname(pointerFile), savedAs), resolve(folder, savedAs), resolve(dirname(pointerFile), '..', '..', savedAs)];
  const path = candidates.find((candidate) => existsSync(candidate));
  if (!path) throw new GateError('source_not_saved', `${savedAs}: server-saved original not found`);
  return path;
}

// The file the model names is only {"savedAs":"<path>"}. A transcribed tool return is refused.
export function loadHubReturn(folder, pointerFile) {
  const savedAs = assertPointer(readJson(pointerFile), pointerFile);
  const path = resolveSaved(folder, pointerFile, savedAs);
  const saved = readJson(path);
  const raw = saved && typeof saved === 'object' && saved.response ? saved.response : saved;
  if (!raw || typeof raw !== 'object' || !raw.result) throw new GateError('source_not_saved', `${savedAs}: not a hub tool return`);
  return { result: raw.result, evidenceId: raw.evidence?.[0]?.evidenceId ?? null, savedAs, path };
}

export function loadPointedReturn(folder, source, label) {
  const savedAs = assertPointer(source, label);
  const path = resolveSaved(folder, folder, savedAs);
  const saved = readJson(path);
  const raw = saved && typeof saved === 'object' && saved.response ? saved.response : saved;
  if (!raw || typeof raw !== 'object' || !raw.result) throw new GateError('source_not_saved', `${savedAs}: not a hub tool return`);
  return { result: raw.result, evidenceId: raw.evidence?.[0]?.evidenceId ?? null, savedAs, path };
}

export function utf8FromBase64(result) {
  if (typeof result?.contentBase64 !== 'string') throw new GateError('source_not_saved', 'docs.get result has no contentBase64');
  const bytes = Buffer.from(result.contentBase64, 'base64');
  const text = bytes.toString('utf8');
  if (!Buffer.from(text).equals(bytes)) throw new GateError('source_not_saved', 'document is not UTF-8');
  return text;
}

export function sectionText(result) {
  if (!Array.isArray(result?.lines)) throw new GateError('source_not_saved', 'docs.section result has no lines');
  return result.lines.map((line) => (typeof line?.text === 'string' ? line.text : '')).join('\n');
}

export function assertVerbatim(quote, source, label) {
  if (typeof quote !== 'string' || quote.trim() !== quote || !quote.trim()) throw new GateError('quote_not_verbatim', `${label}: quote is empty or padded`);
  if (!source.includes(quote)) throw new GateError('quote_not_verbatim', `${label}: quote is not in the server-saved original`);
  return quote;
}

export function assertOriginModel(value, label) {
  if (value?.origin !== 'model') throw new GateError('schema_invalid', `${label} origin must be model`);
}
