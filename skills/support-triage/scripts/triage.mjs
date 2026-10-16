#!/usr/bin/env node
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { assertCovered, assertExactKeys, assertOriginModel, assertVerbatim, loadOriginal, readJson, sha256 } from './pointers.mjs';

const CREDENTIAL = /(?:password|api[_-]?key|secret|token)\s*[:=]\s*\S+|Bearer\s+\S+|\bsk-[A-Za-z0-9]{8,}/gi;
const ITEM_KEYS = ['id', 'intent', 'quote', 'severity'];
const SEVERITIES = ['critical', 'high', 'medium', 'low'];

export function priorityOf(severity, policy) {
  const row = policy.severities?.[severity];
  if (!row) throw new Error(`schema_invalid: severity ${severity}`);
  return row.priority;
}

export function redact(text) {
  return text.replace(CREDENTIAL, '[redacted]');
}

export function routeOne(ticket, item, policy) {
  const blob = `${ticket.subject ?? ''}\n${ticket.body ?? ''}`;
  const credential = CREDENTIAL.test(blob);
  CREDENTIAL.lastIndex = 0;
  const judged = policy.severities[item.severity];
  if (!judged) throw new Error(`schema_invalid: severity ${item.severity}`);
  if (credential) return { queue: policy.credential.queue, responseMinutes: policy.credential.responseMinutes, priority: judged.priority, credential: true, intentUnlisted: false };
  const row = policy.intents[item.intent];
  if (!row) return { queue: policy.default.queue, responseMinutes: policy.severities[policy.default.severity].responseMinutes, priority: policy.severities[policy.default.severity].priority, credential: false, intentUnlisted: true };
  return { queue: row.queue, responseMinutes: judged.responseMinutes, priority: judged.priority, credential: false, intentUnlisted: false };
}

export function gateTriage(folder, contractPath, policyPath) {
  const bytes = readFileSync(contractPath);
  const policyBytes = readFileSync(policyPath);
  const contract = readJson(contractPath);
  const policy = readJson(policyPath);
  assertExactKeys(contract, ['items', 'origin', 'schema', 'source'], 'triage contract');
  assertOriginModel(contract, 'triage contract');
  if (contract.schema !== 'enterprise/triage-contract/1' || !Array.isArray(contract.items)) throw new Error('schema_invalid: items');
  if (policy.schema !== 'enterprise/sla-policy/1' || !policy.severities) throw new Error('schema_invalid: policy');
  const saved = loadOriginal(folder, contract.source, 'ticket source');
  const payload = JSON.parse(saved.text);
  const tickets = Array.isArray(payload.tickets) ? payload.tickets : payload;
  if (!Array.isArray(tickets)) throw new Error('schema_invalid: tickets');
  assertCovered(tickets.map((ticket) => ticket.id), contract.items.map((item) => item.id), 'tickets');
  const ranked = contract.items.map((item, index) => {
    assertExactKeys(item, ITEM_KEYS, `item ${index}`);
    if (!SEVERITIES.includes(item.severity)) throw new Error(`schema_invalid: item ${index} severity`);
    const ticket = tickets.find((row) => row.id === item.id);
    if (!ticket) throw new Error(`schema_invalid: ${item.id} is not in the saved tickets`);
    const blob = `${ticket.subject ?? ''}\n${ticket.body ?? ''}`;
    assertVerbatim(item.quote, blob, item.id);
    const route = routeOne(ticket, item, policy);
    return {
      id: item.id,
      intent: item.intent,
      severity: item.severity,
      quote: redact(item.quote),
      subject: redact(String(ticket.subject ?? '')),
      ...route,
      evidenceId: saved.evidenceId,
      origin: 'script',
    };
  });
  const gate = { ok: true, origin: 'script', contractSha256: sha256(bytes), policySha256: sha256(policyBytes), ranked };
  writeFileSync(join(folder, 'gate.json'), `${JSON.stringify(gate, null, 2)}\n`);
  return gate;
}

export function emitTriage(folder, contractPath, policyPath) {
  const gate = readJson(join(folder, 'gate.json'));
  if (gate?.ok !== true) throw new Error('gate_not_passed');
  if (sha256(readFileSync(contractPath)) !== gate.contractSha256) throw new Error('contract_changed_after_gate');
  if (policyPath && sha256(readFileSync(policyPath)) !== gate.policySha256) throw new Error('contract_changed_after_gate');
  const gaps = gate.ranked.filter((row) => row.credential || row.intentUnlisted).map((row) => ({
    subject: `ticket:${row.id}`,
    predicate: row.credential ? 'credential_filtered' : 'intent_unlisted',
    value: row.id,
    origin: 'script',
    evidenceIds: row.evidenceId ? [row.evidenceId] : [],
  }));
  const lines = [
    '# Ticket routing',
    '',
    'Intent and severity are model judgement. Queue, SLA and the credential filter are a script over the pinned policy.',
    '',
    ...gate.ranked.map((row) => `## ${row.id}\n\nintent ${row.intent} severity ${row.severity} → ${row.queue} in ${row.responseMinutes} minutes (${row.priority})${row.credential ? '\n\nCredential filtered.' : ''}`),
    '',
  ];
  mkdirSync(join(folder, 'out'), { recursive: true });
  writeFileSync(join(folder, 'out', 'triage.json'), `${JSON.stringify(gate.ranked, null, 2)}\n`);
  writeFileSync(join(folder, 'out', 'replies.md'), lines.join('\n'));
  writeFileSync(join(folder, 'out', 'kb_gaps.json'), `${JSON.stringify(gaps, null, 2)}\n`);
  return { ranked: gate.ranked, gaps };
}

if (process.argv[1] && import.meta.url === `file://${process.argv[1]}`) {
  const [folder, ...rest] = process.argv.slice(2);
  const args = {};
  for (let i = 0; i < rest.length; i++) if (rest[i].startsWith('--')) args[rest[i].slice(2)] = rest[++i];
  if (process.argv[1].endsWith('triage.mjs') && args.contract && args.policy && !args.emit) gateTriage(folder, args.contract, args.policy);
}
