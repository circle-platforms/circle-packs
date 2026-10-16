#!/usr/bin/env node
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { assertCovered, assertExactKeys, assertOriginModel, assertVerbatim, loadOriginal, readJson, sha256 } from './pointers.mjs';

const LABEL_KEYS = ['at', 'event', 'incident', 'quote'];

export function unixMs(year, month, day, hour, minute, second) {
  if (month < 1 || month > 12 || day < 1 || day > 31 || hour > 23 || minute > 59 || second > 59) throw new Error(`bad timestamp ${year}-${month}-${day}`);
  const adjust = Math.floor((14 - month) / 12);
  const y = year - adjust;
  const m = month + 12 * adjust - 3;
  const days = day + Math.floor((153 * m + 2) / 5) + 365 * y + Math.floor(y / 4) - Math.floor(y / 100) + Math.floor(y / 400) - 719469;
  return ((days * 24 + hour) * 60 + minute) * 60 * 1000 + second * 1000;
}

export function parseTimestamp(text, zones) {
  const match = /^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2})(?::(\d{2}))?(?:\s*(Z|UTC|GMT|JST|CST|[+-]\d{2}:\d{2}))?$/.exec(text.trim());
  if (!match) throw new Error(`bad timestamp ${text}`);
  const local = unixMs(Number(match[1]), Number(match[2]), Number(match[3]), Number(match[4]), Number(match[5]), Number(match[6] ?? 0));
  let offset = 0;
  const zone = match[7];
  if (zone === 'Z') offset = 0;
  else if (zone && Object.prototype.hasOwnProperty.call(zones, zone)) offset = zones[zone];
  else if (zone && /^[+-]\d{2}:\d{2}$/.test(zone)) {
    const sign = zone[0] === '-' ? -1 : 1;
    offset = sign * (Number(zone.slice(1, 3)) * 60 + Number(zone.slice(4, 6)));
  } else if (zone) throw new Error(`bad timestamp ${text}`);
  return local - offset * 60000;
}

export function gateLabels(folder, labelsPath, policyPath) {
  const bytes = readFileSync(labelsPath);
  const policyBytes = readFileSync(policyPath);
  const contract = readJson(labelsPath);
  const policy = readJson(policyPath);
  assertExactKeys(contract, ['labels', 'origin', 'schema', 'source'], 'labels');
  assertOriginModel(contract, 'labels');
  if (contract.schema !== 'enterprise/event-labels/1' || !Array.isArray(contract.labels) || !contract.labels.length) throw new Error('schema_invalid: labels');
  if (policy.schema !== 'enterprise/incident-policy/1' || typeof policy.startEvent !== 'string' || typeof policy.endEvent !== 'string') throw new Error('schema_invalid: policy');
  const events = new Set(policy.events ?? [policy.startEvent, policy.endEvent]);
  const saved = loadOriginal(folder, contract.source, 'log source');
  const lines = saved.text.split(/\r?\n/).filter((line) => line.trim());
  const labeled = contract.labels.map((label, index) => {
    assertExactKeys(label, LABEL_KEYS, `label ${index}`);
    if (!events.has(label.event)) throw new Error(`schema_invalid: label ${index} event`);
    if (typeof label.incident !== 'string' || !/^[A-Za-z0-9-]{1,40}$/.test(label.incident)) throw new Error(`schema_invalid: label ${index} incident`);
    assertVerbatim(label.quote, saved.text, `label ${index}`);
    if (!lines.includes(label.quote)) throw new Error(`quote_not_verbatim: label ${index} is not a whole log line`);
    if (!label.quote.includes(label.incident)) throw new Error(`quote_not_verbatim: label ${index} incident is not in the quote`);
    if (!label.quote.includes(label.at)) throw new Error(`quote_not_verbatim: label ${index} timestamp is not in the quote`);
    const atMs = parseTimestamp(label.at, policy.timezones ?? {});
    return { quote: label.quote, incident: label.incident, event: label.event, at: label.at, atMs };
  });
  assertCovered(lines, labeled.map((label) => label.quote), 'lines');
  const marks = new Map();
  for (const label of labeled) {
    const row = marks.get(label.incident) ?? {};
    row[label.event] = label;
    marks.set(label.incident, row);
  }
  const durations = [];
  const missing = [];
  for (const incident of [...marks.keys()].sort()) {
    const row = marks.get(incident);
    const missingFields = [];
    if (!row[policy.startEvent]) missingFields.push(policy.startEvent);
    if (!row[policy.endEvent]) missingFields.push(policy.endEvent);
    if (missingFields.length) {
      missing.push({ incident, missingFields });
      continue;
    }
    const minutes = (row[policy.endEvent].atMs - row[policy.startEvent].atMs) / 60000;
    if (!Number.isFinite(minutes) || minutes < 0) throw new Error(`incident ${incident} resolved before it opened`);
    durations.push({ incident, minutes });
  }
  if (missing.length) {
    const detail = missing.map((row) => `${row.incident} missing ${row.missingFields.join(', ')}`).join('; ');
    throw new Error(`metrics_missing: ${detail}`);
  }
  const eventsOut = labeled
    .map((label) => ({ at: label.at, atMs: label.atMs, incident: label.incident, event: label.event }))
    .sort((a, b) => a.atMs - b.atMs || (a.incident < b.incident ? -1 : 1));
  const mttrMinutes = durations.reduce((sum, row) => sum + row.minutes, 0) / durations.length;
  const timeline = { events: eventsOut, durations, missing, mttrMinutes, origin: 'script' };
  const gate = {
    ok: true,
    origin: 'script',
    contractSha256: sha256(bytes),
    policySha256: sha256(policyBytes),
    timeline,
    evidenceId: saved.evidenceId,
    path: saved.result?.path ?? saved.savedAs,
  };
  writeFileSync(join(folder, 'gate.json'), `${JSON.stringify(gate, null, 2)}\n`);
  return gate;
}

export function emitPostmortem(folder, labelsPath, policyPath) {
  const gate = readJson(join(folder, 'gate.json'));
  if (gate?.ok !== true) throw new Error('gate_not_passed');
  if (sha256(readFileSync(labelsPath)) !== gate.contractSha256) throw new Error('contract_changed_after_gate');
  if (policyPath && sha256(readFileSync(policyPath)) !== gate.policySha256) throw new Error('contract_changed_after_gate');
  const timeline = gate.timeline;
  const lines = [
    '# Incident postmortem',
    '',
    `MTTR minutes: ${timeline.mttrMinutes}`,
    '',
    '## Timeline (labels checked, times recomputed)',
    '',
    ...timeline.events.map((event) => `- ${event.at} ${event.incident} ${event.event}`),
    '',
  ];
  mkdirSync(join(folder, 'out'), { recursive: true });
  writeFileSync(join(folder, 'out', 'timeline.json'), `${JSON.stringify({ ...timeline, evidenceId: gate.evidenceId, subject: `incident-log:${gate.path}` }, null, 2)}\n`);
  writeFileSync(join(folder, 'out', 'postmortem.md'), lines.join('\n'));
  return timeline;
}
