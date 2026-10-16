#!/usr/bin/env node
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { assertExactKeys, assertOriginModel, loadPointedReturn, readJson, sha256, utf8FromBase64 } from './pointers.mjs';

const LINE = /^(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z) ([a-z0-9-]+) (opened|acknowledged|mitigated|resolved)(?: (.*))?$/;
const LABEL_KEYS = ['event', 'incident', 'quote'];

export function unixMs(iso) {
  const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})Z$/.exec(iso);
  if (!match) throw new Error(`bad timestamp ${iso}`);
  let year = Number(match[1]);
  let month = Number(match[2]);
  const day = Number(match[3]);
  const hour = Number(match[4]);
  const minute = Number(match[5]);
  const second = Number(match[6]);
  const adjust = Math.floor((14 - month) / 12);
  year -= adjust;
  month += 12 * adjust - 3;
  const days = day + Math.floor((153 * month + 2) / 5) + 365 * year + Math.floor(year / 4) - Math.floor(year / 100) + Math.floor(year / 400) - 719469;
  return ((days * 24 + hour) * 60 + minute) * 60 * 1000 + second * 1000;
}

export function describeLine(line) {
  const match = LINE.exec(line);
  if (match) return { ok: true, at: match[1], incident: match[2], event: match[3], note: match[4] ?? '', missingFields: [] };
  const missingFields = [];
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z(?:\s|$)/.test(line)) missingFields.push('timestamp');
  else {
    const parts = line.slice(21).trim().split(/\s+/);
    if (!/^[a-z0-9-]+$/.test(parts[0] ?? '')) missingFields.push('incident');
    if (!['opened', 'acknowledged', 'mitigated', 'resolved'].includes(parts[1])) missingFields.push('event');
  }
  if (!missingFields.length) missingFields.push('line');
  return { ok: false, missingFields };
}

export function buildTimeline(text) {
  const events = [];
  const unparsed = [];
  for (const line of text.split('\n')) {
    if (!line.trim()) continue;
    const described = describeLine(line);
    if (!described.ok) {
      unparsed.push({ line, missingFields: described.missingFields });
      continue;
    }
    events.push({ at: described.at, incident: described.incident, event: described.event, note: described.note });
  }
  events.sort((a, b) => (a.at < b.at ? -1 : a.at > b.at ? 1 : a.incident < b.incident ? -1 : a.incident > b.incident ? 1 : 0));
  const marks = new Map();
  for (const event of events) {
    const row = marks.get(event.incident) ?? {};
    row[event.event] = event.at;
    marks.set(event.incident, row);
  }
  const durations = [];
  const incomplete = [];
  const missing = [];
  for (const incident of [...marks.keys()].sort()) {
    const row = marks.get(incident);
    const missingFields = [];
    if (!row.opened) missingFields.push('opened');
    if (!row.resolved) missingFields.push('resolved');
    if (missingFields.length) {
      incomplete.push(incident);
      missing.push({ incident, missingFields });
      continue;
    }
    const minutes = (unixMs(row.resolved) - unixMs(row.opened)) / 60000;
    if (!Number.isFinite(minutes) || minutes < 0) throw new Error(`incident ${incident} resolved before it opened`);
    durations.push({ incident, minutes });
  }
  const mttrMinutes = durations.length ? durations.reduce((sum, row) => sum + row.minutes, 0) / durations.length : null;
  return { events, durations, incomplete, missing, unparsed, mttrMinutes, origin: 'script' };
}

export function gateLabels(folder, labelsPath) {
  const bytes = readFileSync(labelsPath);
  const contract = readJson(labelsPath);
  assertExactKeys(contract, ['labels', 'origin', 'schema', 'source'], 'labels');
  assertOriginModel(contract, 'labels');
  if (contract.schema !== 'enterprise/event-labels/1' || !Array.isArray(contract.labels)) throw new Error('schema_invalid: labels');
  const saved = loadPointedReturn(folder, contract.source, 'log source');
  const text = utf8FromBase64(saved.result);
  const lines = new Set(text.split('\n').filter((line) => line.trim()));
  const disagreements = [];
  for (const [index, label] of contract.labels.entries()) {
    assertExactKeys(label, LABEL_KEYS, `label ${index}`);
    if (!lines.has(label.quote)) throw new Error(`quote_not_verbatim: label ${index} is not a whole log line`);
    const described = describeLine(label.quote);
    if (described.ok && (label.event !== described.event || label.incident !== described.incident)) {
      disagreements.push({ quote: label.quote, labeled: { event: label.event, incident: label.incident }, parsed: { event: described.event, incident: described.incident } });
    }
  }
  const timeline = buildTimeline(text);
  const gate = { ok: true, origin: 'script', contractSha256: sha256(bytes), timeline, disagreements, evidenceId: saved.evidenceId, path: saved.result.path ?? 'uploaded' };
  writeFileSync(join(folder, 'gate.json'), `${JSON.stringify(gate, null, 2)}\n`);
  return gate;
}

export function emitPostmortem(folder, labelsPath) {
  const gate = readJson(join(folder, 'gate.json'));
  if (gate?.ok !== true) throw new Error('gate_not_passed');
  if (sha256(readFileSync(labelsPath)) !== gate.contractSha256) throw new Error('contract_changed_after_gate');
  const timeline = gate.timeline;
  const lines = [
    '# Incident postmortem',
    '',
    `MTTR minutes: ${timeline.mttrMinutes === null ? 'none' : timeline.mttrMinutes}`,
    '',
    '## Missing fields (script)',
    '',
    ...(timeline.missing.length ? timeline.missing.map((row) => `- ${row.incident}: ${row.missingFields.join(', ')}`) : ['None.']),
    ...(timeline.unparsed.length ? timeline.unparsed.map((row) => `- unparsed: ${row.missingFields.join(', ')}`) : []),
    '',
    '## Label disagreements (script kept the parse)',
    '',
    gate.disagreements.length ? gate.disagreements.map((row) => `- ${row.quote}: labeled ${row.labeled.event}, parsed ${row.parsed.event}`).join('\n') : 'None.',
    '',
    '## Timeline (script)',
    '',
    ...timeline.events.map((event) => `- ${event.at} ${event.incident} ${event.event}${event.note ? ` ${event.note}` : ''}`),
    '',
  ];
  mkdirSync(join(folder, 'out'), { recursive: true });
  writeFileSync(join(folder, 'out', 'timeline.json'), `${JSON.stringify({ ...timeline, disagreements: gate.disagreements, evidenceId: gate.evidenceId, subject: `incident-log:${gate.path}` }, null, 2)}\n`);
  writeFileSync(join(folder, 'out', 'postmortem.md'), lines.join('\n'));
  return timeline;
}
