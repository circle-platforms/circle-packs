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

function hubPayload(parsed) {
  const raw = parsed && typeof parsed === 'object' && parsed.response ? parsed.response : parsed;
  if (!raw || typeof raw !== 'object' || !raw.result || typeof raw.result !== 'object') return null;
  const result = raw.result;
  if (typeof result.contentBase64 !== 'string' && !Array.isArray(result.lines)) return null;
  return { raw, result };
}

// A pointer targets either a hub docs.get / docs.section return or a user-provided UTF-8 file.
export function loadOriginal(folder, source, label) {
  const savedAs = assertPointer(source, label);
  const path = resolveSaved(folder, folder, savedAs);
  const bytes = readFileSync(path);
  let parsed = null;
  try {
    parsed = JSON.parse(bytes.toString('utf8'));
  } catch {
    parsed = null;
  }
  const hub = parsed ? hubPayload(parsed) : null;
  if (hub) {
    const text = typeof hub.result.contentBase64 === 'string' ? utf8FromBase64(hub.result) : sectionText(hub.result);
    return { text, evidenceId: hub.raw.evidence?.[0]?.evidenceId ?? null, savedAs, path, kind: 'hub', result: hub.result };
  }
  const text = bytes.toString('utf8');
  if (!Buffer.from(text).equals(bytes)) throw new GateError('source_not_saved', `${savedAs}: document is not UTF-8`);
  return { text, evidenceId: null, savedAs, path, kind: 'local', result: null };
}

// The file the model names is only {"savedAs":"<path>"}. A transcribed tool return is refused.
export function loadHubReturn(folder, pointerFile) {
  const savedAs = assertPointer(readJson(pointerFile), pointerFile);
  const path = resolveSaved(folder, pointerFile, savedAs);
  const saved = readJson(path);
  const hub = hubPayload(saved);
  if (!hub) throw new GateError('source_not_saved', `${savedAs}: not a hub tool return`);
  return { result: hub.result, evidenceId: hub.raw.evidence?.[0]?.evidenceId ?? null, savedAs, path };
}

export function loadPointedReturn(folder, source, label) {
  const loaded = loadOriginal(folder, source, label);
  if (loaded.kind !== 'hub') throw new GateError('source_not_saved', `${loaded.savedAs}: not a hub tool return`);
  return { result: loaded.result, evidenceId: loaded.evidenceId, savedAs: loaded.savedAs, path: loaded.path };
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

export function inputIds(text) {
  const trimmed = text.trim();
  if (!trimmed.startsWith('{') && !trimmed.startsWith('[')) return null;
  try {
    const parsed = JSON.parse(text);
    const list = Array.isArray(parsed) ? parsed
      : Array.isArray(parsed?.items) ? parsed.items
      : Array.isArray(parsed?.tickets) ? parsed.tickets
      : Array.isArray(parsed?.rows) ? parsed.rows
      : null;
    if (!list?.length || !list.every((row) => row && typeof row.id === 'string')) return null;
    return list.map((row) => row.id);
  } catch {
    return null;
  }
}

export function assertCovered(expectedIds, coveredIds, label = 'input') {
  const covered = new Set(coveredIds);
  const missing = expectedIds.filter((id) => !covered.has(id));
  if (missing.length) throw new GateError('input_not_covered', `${label}: ${missing.join(', ')}`);
}

// Each non-empty line of a text original must be touched by a quote. A quote is assigned to
// the shortest not-yet-covered line that contains it, or to every full line of a multi-line quote.
export function uncoveredLines(text, quotes) {
  const lines = text.split(/\r?\n/).filter((line) => line.trim());
  const covered = new Set();
  for (const quote of quotes) {
    if (quote.includes('\n')) {
      for (const line of lines) if (quote.split(/\r?\n/).includes(line)) covered.add(line);
      continue;
    }
    const exact = lines.find((line) => line === quote && !covered.has(line));
    if (exact) {
      covered.add(exact);
      continue;
    }
    const holders = lines.filter((line) => !covered.has(line) && line.includes(quote));
    if (!holders.length) continue;
    holders.sort((a, b) => a.length - b.length);
    covered.add(holders[0]);
  }
  return lines.filter((line) => !covered.has(line));
}

export function assertTextCovered(text, quotes, label) {
  const ids = inputIds(text);
  if (ids) return;
  const missing = uncoveredLines(text, quotes);
  if (missing.length) throw new GateError('input_not_covered', `${label}: ${missing.join(' | ')}`);
}

const POLARITY = [
  ['shall not', 'forbid'],
  ['must not', 'forbid'],
  ['may not', 'forbid'],
  ['不得', 'forbid'],
  ['禁止', 'forbid'],
  ['不可', 'forbid'],
  ['不应', 'forbid'],
  ['不准', 'forbid'],
  ['不允许', 'forbid'],
  ['严禁', 'forbid'],
  ['可以', 'permit'],
  ['应当', 'permit'],
  ['允许', 'permit'],
  ['shall', 'permit'],
  ['must', 'permit'],
  ['may', 'permit'],
  ['降为', 'downgrade'],
  ['改为', 'downgrade'],
  ['downgrade', 'downgrade'],
  ['不', 'forbid'],
  ['可', 'permit'],
  ['应', 'permit'],
  ['not', 'forbid'],
];

export function polaritySpans(quote) {
  const used = [];
  const found = [];
  for (const [phrase, effect] of POLARITY) {
    let from = 0;
    while (from < quote.length) {
      const at = quote.indexOf(phrase, from);
      if (at < 0) break;
      const end = at + phrase.length;
      const ascii = /^[A-Za-z ]+$/.test(phrase);
      const boundary = !ascii || ((at === 0 || !/[A-Za-z]/.test(quote[at - 1])) && (end === quote.length || !/[A-Za-z]/.test(quote[end])));
      const overlaps = used.some(([start, stop]) => at < stop && end > start);
      if (boundary && !overlaps) {
        found.push({ cue: phrase, effect });
        used.push([at, end]);
        from = end;
      } else from = at + 1;
    }
  }
  return found;
}

export function assertPolarity(quote, cue, effect, label) {
  if (typeof cue !== 'string' || cue.trim() !== cue || !cue) throw new GateError('polarity_cue_missing', `${label}: cue is empty or padded`);
  if (!quote.includes(cue)) throw new GateError('polarity_cue_missing', `${label}: cue is not a span of the quote`);
  const spans = polaritySpans(quote).filter((span) => span.cue === cue);
  if (!spans.length) throw new GateError('polarity_cue_missing', `${label}: ${cue} is not a polarity cue`);
  if (!spans.some((span) => span.effect === effect)) throw new GateError('polarity_mismatch', `${label}: ${cue} is ${spans[0].effect}, not ${effect}`);
  return cue;
}
