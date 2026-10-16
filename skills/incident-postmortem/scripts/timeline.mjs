#!/usr/bin/env node
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { assertCovered, assertExactKeys, assertKeys, assertOriginModel, assertPolicyPin, assertQuoteAt, GateError, loadOriginal, readJson, sha256, uncoveredLines } from './pointers.mjs';

const ZONE = 'Z|UTC|GMT|JST|CST|[+-]\\d{2}:\\d{2}';
const FULL = new RegExp(`^(\\d{4})-(\\d{2})-(\\d{2})[T ](\\d{2}):(\\d{2})(?::(\\d{2}))?\\s*(${ZONE})$`);
const CLOCK = new RegExp(`^(\\d{2}):(\\d{2})(?::(\\d{2}))?\\s*(${ZONE})$`);

export function unixMs(year, month, day, hour, minute, second) {
  if (month < 1 || month > 12 || day < 1 || day > 31 || hour > 23 || minute > 59 || second > 59) throw new GateError('schema_invalid', `bad timestamp ${year}-${month}-${day}`);
  const adjust = Math.floor((14 - month) / 12);
  const y = year - adjust;
  const m = month + 12 * adjust - 3;
  const days = day + Math.floor((153 * m + 2) / 5) + 365 * y + Math.floor(y / 4) - Math.floor(y / 100) + Math.floor(y / 400) - 719469;
  return ((days * 24 + hour) * 60 + minute) * 60 * 1000 + second * 1000;
}

function zoneOffset(zone, zones) {
  if (zone === 'Z' || zone === 'UTC' || zone === 'GMT') return 0;
  if (Object.prototype.hasOwnProperty.call(zones, zone)) return zones[zone];
  if (/^[+-]\d{2}:\d{2}$/.test(zone)) return (zone[0] === '-' ? -1 : 1) * (Number(zone.slice(1, 3)) * 60 + Number(zone.slice(4, 6)));
  throw new GateError('schema_invalid', `bad zone ${zone}`);
}

export function parseTimestamp(text, zones, date) {
  const full = FULL.exec(text.trim());
  if (full) {
    const local = unixMs(Number(full[1]), Number(full[2]), Number(full[3]), Number(full[4]), Number(full[5]), Number(full[6] ?? 0));
    return { ms: local - zoneOffset(full[7], zones) * 60000, assumption: null };
  }
  const clock = CLOCK.exec(text.trim());
  if (clock) {
    if (!date) throw new GateError('date_missing', text);
    const local = unixMs(date.year, date.month, date.day, Number(clock[1]), Number(clock[2]), Number(clock[3] ?? 0));
    return { ms: local - zoneOffset(clock[4], zones) * 60000, assumption: date };
  }
  if (/^\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}/.test(text.trim())) throw new GateError('zone_missing', text);
  throw new GateError('schema_invalid', `bad timestamp ${text}`);
}

function readExtract(path) {
  const bytes = readFileSync(path);
  const contract = readJson(path);
  assertExactKeys(contract, ['labels', 'origin', 'schema', 'source'], path);
  assertOriginModel(contract, path);
  if (contract.schema !== 'enterprise/event-labels/2' || !Array.isArray(contract.labels) || !contract.labels.length) throw new GateError('schema_invalid', `${path} labels`);
  return { bytes, contract };
}

function dateFromOf(text, label) {
  if (label.dateFrom == null) return null;
  assertExactKeys(label.dateFrom, ['offset', 'quote'], 'dateFrom');
  assertQuoteAt(text, label.dateFrom.quote, label.dateFrom.offset, 'dateFrom');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(label.dateFrom.quote)) throw new GateError('schema_invalid', 'dateFrom is not a date');
  if (label.dateFrom.offset >= label.offset) throw new GateError('date_missing', 'dateFrom is not earlier context');
  return { year: Number(label.dateFrom.quote.slice(0, 4)), month: Number(label.dateFrom.quote.slice(5, 7)), day: Number(label.dateFrom.quote.slice(8, 10)), quote: label.dateFrom.quote, offset: label.dateFrom.offset };
}

function indexLabels(contract, saved, events, zones, label) {
  const rows = [];
  const seenOffset = new Set();
  const seenIncident = new Set();
  contract.labels.forEach((item, index) => {
    const name = `${label} ${index}`;
    assertKeys(item, ['event', 'offset', 'quote'], ['at', 'dateFrom', 'incident'], name);
    if (!events.has(item.event)) throw new GateError('schema_invalid', `${name} event`);
    if (item.incident != null && !/^[A-Za-z0-9-]{1,40}$/.test(item.incident)) throw new GateError('schema_invalid', `${name} incident`);
    assertQuoteAt(saved.text, item.quote, item.offset, name);
    const lineStart = item.offset === 0 || saved.text[item.offset - 1] === '\n';
    const lineEnd = item.offset + item.quote.length === saved.text.length || saved.text[item.offset + item.quote.length] === '\n';
    if (!lineStart || !lineEnd || item.quote.includes('\n')) throw new GateError('quote_not_verbatim', `${name} is not a whole line`);
    const offsetKey = String(item.offset);
    if (seenOffset.has(offsetKey)) throw new GateError('duplicate_label', `${name} offset`);
    seenOffset.add(offsetKey);
    if (item.incident) {
      const key = `${item.incident}\0${item.event}`;
      if (seenIncident.has(key)) throw new GateError('duplicate_label', `${name} ${item.event}`);
      seenIncident.add(key);
    }
    let parsed = null;
    let assumption = null;
    if (item.at != null) {
      if (!item.quote.includes(item.at)) throw new GateError('quote_not_verbatim', `${name} timestamp`);
      const date = dateFromOf(saved.text, item);
      parsed = parseTimestamp(item.at, zones, date);
      assumption = parsed.assumption ? { date: item.dateFrom.quote, quote: item.dateFrom.quote, offset: item.dateFrom.offset } : null;
    } else if (item.event !== 'other') throw new GateError('schema_invalid', `${name} at`);
    rows.push({ quote: item.quote, offset: item.offset, event: item.event, incident: item.incident ?? null, at: item.at ?? null, atMs: parsed?.ms ?? null, assumption });
  });
  return rows;
}

function coverQuotes(text, rows) {
  const quotes = [];
  for (const row of rows) {
    quotes.push(row.quote);
    if (row.assumption) quotes.push(row.assumption.quote);
  }
  const missing = uncoveredLines(text, quotes);
  if (missing.length) throw new GateError('input_not_covered', missing.join(' | '));
}

export function gateLabels(folder, leftPath, rightPath, policyPath, pinPath) {
  const left = readExtract(leftPath);
  const right = readExtract(rightPath);
  const policyBytes = readFileSync(policyPath);
  const policy = readJson(policyPath);
  assertPolicyPin(policyBytes, readJson(pinPath));
  if (policy.schema !== 'enterprise/incident-policy/2' || !Array.isArray(policy.events) || !Array.isArray(policy.metrics)) throw new GateError('schema_invalid', 'policy');
  const zones = policy.timezones ?? {};
  const events = new Set(policy.events);
  const saved = loadOriginal(folder, left.contract.source, 'log source');
  if (right.contract.source.savedAs !== saved.savedAs) throw new GateError('pointer_not_transcribe', 'extracts name different sources');
  const leftRows = indexLabels(left.contract, saved, events, zones, 'left');
  const rightRows = indexLabels(right.contract, saved, events, zones, 'right');
  coverQuotes(saved.text, leftRows);
  coverQuotes(saved.text, rightRows);
  const rightBy = new Map(rightRows.map((row) => [row.offset, row]));
  assertCovered(leftRows.map((row) => String(row.offset)), rightRows.map((row) => String(row.offset)), 'labels');
  assertCovered(rightRows.map((row) => String(row.offset)), leftRows.map((row) => String(row.offset)), 'labels');
  const labeled = leftRows.map((row) => {
    const other = rightBy.get(row.offset);
    if (!other || other.event !== row.event || other.incident !== row.incident || other.at !== row.at) {
      return { ...row, decision: 'needs_human', atMs: null };
    }
    return { ...row, decision: 'agreed' };
  });
  const needsHuman = labeled.some((row) => row.decision === 'needs_human');
  const agreed = labeled.filter((row) => row.decision === 'agreed' && row.event !== 'other');
  const groups = new Map();
  for (const row of agreed) {
    const key = row.incident ?? '';
    const group = groups.get(key) ?? {};
    group[row.event] = row;
    groups.set(key, group);
  }
  const metrics = [];
  if (!needsHuman) {
    for (const metric of policy.metrics) {
      const missing = [];
      const minutes = [];
      for (const [incident, group] of groups) {
        const absent = [metric.start, metric.end].filter((event) => !group[event]);
        if (absent.length) missing.push(`${incident || '(none)'} ${metric.id} missing ${absent.join(', ')}`);
        else {
          const value = (group[metric.end].atMs - group[metric.start].atMs) / 60000;
          if (!Number.isFinite(value) || value < 0) throw new GateError('schema_invalid', `${metric.id} ended before it started`);
          minutes.push(value);
        }
      }
      if (!minutes.length) missing.push(`${metric.id} missing samples`);
      if (missing.length) throw new GateError('metrics_missing', missing.join('; '));
      metrics.push({ id: metric.id, minutes: minutes.reduce((sum, value) => sum + value, 0) / minutes.length, samples: minutes.length });
    }
  }
  const timeline = {
    events: labeled.map((row) => ({ at: row.at, incident: row.incident, event: row.event, offset: row.offset, decision: row.decision, assumption: row.assumption })),
    metrics: needsHuman ? null : metrics,
    needsHuman,
    origin: 'script',
  };
  const gate = {
    ok: true,
    needsHuman,
    origin: 'script',
    leftSha256: sha256(left.bytes),
    rightSha256: sha256(right.bytes),
    policySha256: sha256(policyBytes),
    timeline,
    evidenceId: saved.evidenceId,
    path: saved.result?.path ?? saved.savedAs,
  };
  writeFileSync(join(folder, 'gate.json'), `${JSON.stringify(gate, null, 2)}\n`);
  return gate;
}

export function emitPostmortem(folder, leftPath, rightPath, policyPath) {
  const gate = readJson(join(folder, 'gate.json'));
  if (gate?.ok !== true) throw new Error('gate_not_passed');
  if (sha256(readFileSync(leftPath)) !== gate.leftSha256 || sha256(readFileSync(rightPath)) !== gate.rightSha256) throw new Error('contract_changed_after_gate');
  if (sha256(readFileSync(policyPath)) !== gate.policySha256) throw new Error('policy_changed_after_gate');
  const timeline = gate.timeline;
  const metricLines = timeline.needsHuman ? ['Needs human: the two extracts disagree. No duration was chosen.'] : timeline.metrics.map((metric) => `${metric.id} minutes: ${metric.minutes}`);
  const lines = [
    '# Incident postmortem',
    '',
    ...metricLines,
    '',
    '## Timeline',
    '',
    ...timeline.events.map((event) => `- ${event.at ?? '(no clock)'} ${event.incident ?? '(no incident)'} ${event.event}${event.assumption ? ` (assumed date ${event.assumption.date} from "${event.assumption.quote}")` : ''}${event.decision === 'needs_human' ? ' needs human' : ''}`),
    '',
  ];
  mkdirSync(join(folder, 'out'), { recursive: true });
  writeFileSync(join(folder, 'out', 'timeline.json'), `${JSON.stringify({ ...timeline, evidenceId: gate.evidenceId, subject: `incident-log:${gate.path}` }, null, 2)}\n`);
  writeFileSync(join(folder, 'out', 'postmortem.md'), lines.join('\n'));
  return timeline;
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
    console.error('usage: node timeline.mjs <folder> --left <file> --right <file> --policy <file> --pin <file>');
    process.exit(2);
  }
  gateLabels(folder, args.left, args.right, args.policy, args.pin);
}
