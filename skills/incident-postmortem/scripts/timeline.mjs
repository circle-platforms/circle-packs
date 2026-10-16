#!/usr/bin/env node
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';

const LINE = /^(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z) ([a-z0-9-]+) (opened|acknowledged|mitigated|resolved)(?: (.*))?$/;

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

export function buildTimeline(text) {
  const events = [];
  for (const line of text.split('\n')) {
    if (!line.trim()) continue;
    const match = LINE.exec(line);
    if (!match) throw new Error(`unreadable log line: ${line.slice(0, 120)}`);
    events.push({ at: match[1], incident: match[2], event: match[3], note: match[4] ?? '' });
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
  for (const incident of [...marks.keys()].sort()) {
    const row = marks.get(incident);
    if (!row.opened || !row.resolved) { incomplete.push(incident); continue; }
    const minutes = (unixMs(row.resolved) - unixMs(row.opened)) / 60000;
    if (!Number.isFinite(minutes) || minutes < 0) throw new Error(`incident ${incident} resolved before it opened`);
    durations.push({ incident, minutes });
  }
  const mttrMinutes = durations.length ? durations.reduce((sum, row) => sum + row.minutes, 0) / durations.length : null;
  return { events, durations, incomplete, mttrMinutes, origin: 'script' };
}

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
  if (typeof raw?.result?.contentBase64 !== 'string') throw new Error(`${arg}: docs.get result has no contentBase64`);
  const bytes = Buffer.from(raw.result.contentBase64, 'base64');
  const text = bytes.toString('utf8');
  if (!Buffer.from(text).equals(bytes)) throw new Error('document is not UTF-8');
  return { text, path: raw.result.path ?? 'uploaded', evidenceId: raw.evidence?.[0]?.evidenceId ?? null };
}

export function writePostmortem(folder, saved, narrative) {
  if (narrative?.origin !== 'model' || typeof narrative.text !== 'string') throw new Error('narrative.json must be model judgement');
  const timeline = buildTimeline(saved.text);
  const lines = [
    '# Incident postmortem',
    '',
    `MTTR minutes: ${timeline.mttrMinutes === null ? 'none' : timeline.mttrMinutes}`,
    `Incomplete: ${timeline.incomplete.length ? timeline.incomplete.join(', ') : 'none'}`,
    '',
    '## Timeline (script)',
    '',
    ...timeline.events.map((event) => `- ${event.at} ${event.incident} ${event.event}${event.note ? ` ${event.note}` : ''}`),
    '',
    '## Narrative (model)',
    '',
    narrative.text,
    '',
  ];
  mkdirSync(join(folder, 'out'), { recursive: true });
  writeFileSync(join(folder, 'out', 'timeline.json'), `${JSON.stringify({ ...timeline, evidenceId: saved.evidenceId, subject: `incident-log:${saved.path}` }, null, 2)}\n`);
  writeFileSync(join(folder, 'out', 'postmortem.md'), lines.join('\n'));
  return timeline;
}

if (process.argv[1] && import.meta.url === `file://${process.argv[1]}`) {
  const [folder, ...rest] = process.argv.slice(2);
  let get, narrative;
  for (let i = 0; i < rest.length; i++) {
    if (rest[i] === '--get') get = rest[++i];
    else if (rest[i] === '--narrative') narrative = rest[++i];
  }
  if (!folder || !get || !narrative) {
    console.error('usage: node timeline.mjs <folder> --get <file> --narrative <narrative.json>');
    process.exit(2);
  }
  writePostmortem(folder, loadSaved(folder, get), readJson(narrative));
}
