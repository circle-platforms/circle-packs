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

export function assertKeys(value, required, optional, label) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new GateError('schema_invalid', `${label} is not an object`);
  const keys = Object.keys(value);
  for (const key of required) if (!keys.includes(key)) throw new GateError('schema_invalid', `${label} missing ${key}`);
  const allowed = new Set([...required, ...optional]);
  const extra = keys.filter((key) => !allowed.has(key));
  if (extra.length) throw new GateError('schema_invalid', `${label} unexpected ${extra.join(', ')}`);
}

export function assertQuoteAt(text, quote, offset, label) {
  if (typeof quote !== 'string' || quote.trim() !== quote || !quote.trim()) throw new GateError('quote_not_verbatim', `${label}: quote is empty or padded`);
  if (!Number.isInteger(offset) || offset < 0) throw new GateError('quote_not_verbatim', `${label}: offset`);
  if (text.slice(offset, offset + quote.length) !== quote) throw new GateError('quote_not_verbatim', `${label}: quote is not at offset ${offset}`);
  return quote;
}

// The cue and the cited predicate are adjacent when only space or a short mark sits between them.
// This does not decide what the cue means.
export function assertAdjacent(quote, cue, predicate, label) {
  if (typeof cue !== 'string' || !cue || !quote.includes(cue)) throw new GateError('cue_not_in_quote', `${label}: cue`);
  if (typeof predicate !== 'string' || !predicate || !quote.includes(predicate)) throw new GateError('predicate_not_in_quote', `${label}: predicate`);
  const findAll = (needle) => {
    const at = [];
    let from = 0;
    while (from < quote.length) {
      const index = quote.indexOf(needle, from);
      if (index < 0) break;
      at.push(index);
      from = index + 1;
    }
    return at;
  };
  for (const cueAt of findAll(cue)) {
    for (const predicateAt of findAll(predicate)) {
      const [start, end] = cueAt <= predicateAt ? [cueAt + cue.length, predicateAt] : [predicateAt + predicate.length, cueAt];
      if (start <= end && /^[\s　,，、：:]{0,4}$/.test(quote.slice(start, end))) return true;
    }
  }
  throw new GateError('cue_not_adjacent', `${label}: cue is not adjacent to the predicate`);
}

const CN_DIGIT = { 零: 0, 〇: 0, 一: 1, 二: 2, 两: 2, 三: 3, 四: 4, 五: 5, 六: 6, 七: 7, 八: 8, 九: 9 };

export function parseChineseInteger(text) {
  if (/^\d+$/.test(text)) return Number(text);
  let total = 0;
  let current = 0;
  for (const ch of text) {
    if (Object.prototype.hasOwnProperty.call(CN_DIGIT, ch)) current = CN_DIGIT[ch];
    else if (ch === '十' || ch === '百' || ch === '千') {
      const scale = ch === '十' ? 10 : ch === '百' ? 100 : 1000;
      total += (current || 1) * scale;
      current = 0;
    } else return null;
  }
  return total + current;
}

// 天 and 日 are days. 月 is a month. 90天 is 90 days, not 90 months and not 3 months.
// English day/month words are the same split. The two units are never converted.
export function parseQuantity(text) {
  if (typeof text !== 'string') return null;
  const match = /([0-9]+|[零〇一两二三四五六七八九十百千]+)\s*个?\s*(天|日|月|days?|months?)/i.exec(text);
  if (!match) return null;
  const value = parseChineseInteger(match[1]);
  if (value == null) return null;
  const unit = match[2] === '月' || /^months?$/i.test(match[2]) ? 'month' : 'day';
  return { value, unit, span: match[0] };
}

export function assertPolicyPin(policyBytes, pin) {
  if (!pin || pin.schema !== 'circle-packs/policy-pin/1' || typeof pin.sha256 !== 'string') throw new GateError('policy_pin_mismatch', 'pin schema');
  if (pin.approved !== true) throw new GateError('policy_not_approved', 'pin is not approved');
  if (pin.sha256 !== sha256(policyBytes)) throw new GateError('policy_pin_mismatch', 'policy bytes do not match the approved pin');
}

export function addCalendarDays(iso, days) {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
  if (!match || !Number.isInteger(days)) throw new GateError('schema_invalid', `bad date ${iso}`);
  let year = Number(match[1]);
  let month = Number(match[2]);
  let day = Number(match[3]) + days;
  const dim = (y, m) => (m === 2 ? ((y % 4 === 0 && y % 100 !== 0) || y % 400 === 0 ? 29 : 28) : [0, 31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31][m]);
  while (day > dim(year, month)) {
    day -= dim(year, month);
    month += 1;
    if (month > 12) { month = 1; year += 1; }
  }
  while (day < 1) {
    month -= 1;
    if (month < 1) { month = 12; year -= 1; }
    day += dim(year, month);
  }
  return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}
