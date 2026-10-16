#!/usr/bin/env node
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { assertCovered, assertExactKeys, assertKeys, assertOriginModel, assertPolicyPin, assertQuoteAt, GateError, loadOriginal, readJson, sha256 } from './pointers.mjs';

const CREDENTIAL = /(?:password|api[_-]?key|secret|token)\s*[:=]\s*\S+|Bearer\s+\S+|\bsk-[A-Za-z0-9]{8,}/gi;
const SEVERITIES = ['low', 'medium', 'high', 'critical'];

export function priorityOf(severity, policy) {
  const row = policy.severities?.[severity];
  if (!row) throw new GateError('schema_invalid', `severity ${severity}`);
  return row.priority;
}

export function redact(text) {
  return text.replace(CREDENTIAL, '[redacted]');
}

export function ticketRecords(text) {
  let parsed;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new GateError('schema_invalid', 'tickets');
  }
  if (parsed && typeof parsed.text === 'string' && parsed.tickets == null) return [{ id: 'text', text: parsed.text }];
  if (!Array.isArray(parsed?.tickets)) throw new GateError('schema_invalid', 'tickets');
  return parsed.tickets.map((ticket, index) => {
    if (!ticket || typeof ticket !== 'object') throw new GateError('schema_invalid', `ticket ${index}`);
    if (typeof ticket.text === 'string') return { id: ticket.id ?? `t-${index + 1}`, text: ticket.text };
    if (typeof ticket.id !== 'string') throw new GateError('schema_invalid', `ticket ${index} id`);
    return { id: ticket.id, text: `${ticket.subject ?? ''}\n${ticket.body ?? ''}` };
  });
}

function raiseFloor(intent, severity, policy) {
  const floor = policy.floors?.[intent] ?? null;
  if (!floor) return { severity, judgedSeverity: severity, severityRaised: false, floorApplied: null };
  if (!SEVERITIES.includes(floor)) throw new GateError('schema_invalid', `floor ${floor}`);
  if (SEVERITIES.indexOf(severity) < SEVERITIES.indexOf(floor)) {
    return { severity: floor, judgedSeverity: severity, severityRaised: true, floorApplied: floor };
  }
  return { severity, judgedSeverity: severity, severityRaised: false, floorApplied: null };
}

function readExtract(path) {
  const bytes = readFileSync(path);
  const contract = readJson(path);
  assertExactKeys(contract, ['items', 'origin', 'schema', 'source'], path);
  assertOriginModel(contract, path);
  if (contract.schema !== 'enterprise/triage-contract/2' || !Array.isArray(contract.items)) throw new GateError('schema_invalid', `${path} items`);
  return { bytes, contract };
}

function indexItems(contract, tickets, label) {
  const byId = new Map();
  contract.items.forEach((item, index) => {
    assertKeys(item, ['id', 'intent', 'offset', 'quote', 'severity'], [], `${label} ${index}`);
    if (!SEVERITIES.includes(item.severity)) throw new GateError('schema_invalid', `${label} ${index} severity`);
    const ticket = tickets.find((row) => row.id === item.id);
    if (!ticket) throw new GateError('schema_invalid', `${item.id} is not in the saved tickets`);
    assertQuoteAt(ticket.text, item.quote, item.offset, item.id);
    if (byId.has(item.id)) throw new GateError('schema_invalid', `${label} duplicate ${item.id}`);
    byId.set(item.id, item);
  });
  assertCovered(tickets.map((ticket) => ticket.id), [...byId.keys()], 'tickets');
  return byId;
}

export function gateTriage(folder, leftPath, rightPath, policyPath, pinPath) {
  const left = readExtract(leftPath);
  const right = readExtract(rightPath);
  const policyBytes = readFileSync(policyPath);
  const policy = readJson(policyPath);
  assertPolicyPin(policyBytes, readJson(pinPath));
  if (policy.schema !== 'enterprise/sla-policy/2' || !policy.severities || !policy.intents) throw new GateError('schema_invalid', 'policy');
  const saved = loadOriginal(folder, left.contract.source, 'ticket source');
  if (right.contract.source.savedAs !== saved.savedAs) throw new GateError('pointer_not_transcribe', 'extracts name different sources');
  const tickets = ticketRecords(saved.text);
  const leftBy = indexItems(left.contract, tickets, 'left');
  const rightBy = indexItems(right.contract, tickets, 'right');
  const ranked = tickets.map((ticket) => {
    const one = leftBy.get(ticket.id);
    const two = rightBy.get(ticket.id);
    const credential = CREDENTIAL.test(ticket.text);
    CREDENTIAL.lastIndex = 0;
    const base = { id: ticket.id, quote: redact(one.quote), subject: redact(ticket.text.split('\n')[0] ?? ''), credential, evidenceId: saved.evidenceId, origin: 'script' };
    if (one.intent !== two.intent || one.severity !== two.severity) {
      return { ...base, intent: null, severity: null, decision: 'needs_human', queue: null, responseMinutes: null, priority: null, severityRaised: false, floorApplied: null, judgedSeverity: null };
    }
    if (!policy.intents[one.intent]) {
      return { ...base, intent: one.intent, severity: null, decision: 'needs_human', queue: credential ? policy.credential.queue : null, responseMinutes: null, priority: null, severityRaised: false, floorApplied: null, judgedSeverity: one.severity };
    }
    const raised = raiseFloor(one.intent, one.severity, policy);
    const judged = policy.severities[raised.severity];
    return {
      ...base,
      intent: one.intent,
      severity: raised.severity,
      decision: 'routed',
      queue: credential ? policy.credential.queue : policy.intents[one.intent].queue,
      responseMinutes: credential ? policy.credential.responseMinutes : judged.responseMinutes,
      priority: judged.priority,
      ...raised,
    };
  });
  const gate = { ok: true, needsHuman: ranked.some((row) => row.decision === 'needs_human'), origin: 'script', leftSha256: sha256(left.bytes), rightSha256: sha256(right.bytes), policySha256: sha256(policyBytes), ranked };
  writeFileSync(join(folder, 'gate.json'), `${JSON.stringify(gate, null, 2)}\n`);
  return gate;
}

export function emitTriage(folder, leftPath, rightPath, policyPath) {
  const gate = readJson(join(folder, 'gate.json'));
  if (gate?.ok !== true) throw new Error('gate_not_passed');
  if (sha256(readFileSync(leftPath)) !== gate.leftSha256 || sha256(readFileSync(rightPath)) !== gate.rightSha256) throw new Error('contract_changed_after_gate');
  if (sha256(readFileSync(policyPath)) !== gate.policySha256) throw new Error('policy_changed_after_gate');
  const gaps = gate.ranked.filter((row) => row.credential || row.decision === 'needs_human').map((row) => ({
    subject: `ticket:${row.id}`,
    predicate: row.credential ? 'credential_filtered' : 'needs_human',
    value: row.decision,
    origin: 'script',
    evidenceIds: row.evidenceId ? [row.evidenceId] : [],
  }));
  const lines = [
    '# Ticket routing',
    '',
    'Intent and severity are two independent extracts. Queue and SLA are a script only where those extracts agree and the intent is in the pinned policy.',
    '',
    ...gate.ranked.map((row) => {
      if (row.decision === 'needs_human') return `## ${row.id}\n\nNeeds human. No priority was chosen.${row.credential ? '\n\nCredential filtered.' : ''}`;
      const raised = row.severityRaised ? `\n\nSeverity raised from ${row.judgedSeverity} to ${row.severity} by the pinned floor ${row.floorApplied}.` : '';
      return `## ${row.id}\n\nintent ${row.intent} severity ${row.severity} → ${row.queue} in ${row.responseMinutes} minutes (${row.priority})${raised}${row.credential ? '\n\nCredential filtered.' : ''}`;
    }),
    '',
  ];
  mkdirSync(join(folder, 'out'), { recursive: true });
  writeFileSync(join(folder, 'out', 'triage.json'), `${JSON.stringify(gate.ranked, null, 2)}\n`);
  writeFileSync(join(folder, 'out', 'replies.md'), lines.join('\n'));
  writeFileSync(join(folder, 'out', 'kb_gaps.json'), `${JSON.stringify(gaps, null, 2)}\n`);
  return { ranked: gate.ranked, gaps };
}

function flags(argv) {
  const args = {};
  for (let i = 0; i < argv.length; i++) if (argv[i].startsWith('--')) args[argv[i].slice(2)] = argv[++i];
  return args;
}

if (process.argv[1] && import.meta.url === `file://${process.argv[1]}`) {
  const [folder, ...rest] = process.argv.slice(2);
  const args = flags(rest);
  if (process.argv[1].endsWith('triage.mjs') && args.left && args.right && args.policy && args.pin) gateTriage(folder, args.left, args.right, args.policy, args.pin);
}
