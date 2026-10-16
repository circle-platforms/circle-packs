#!/usr/bin/env node
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { assertExactKeys, assertOriginModel, assertVerbatim, loadPointedReturn, readJson, sha256, utf8FromBase64 } from './pointers.mjs';

const CREDENTIAL = /(?:password|api[_-]?key|secret|token)\s*[:=]\s*\S+|Bearer\s+\S+|\bsk-[A-Za-z0-9]{8,}/gi;
const ITEM_KEYS = ['id', 'intent', 'quote'];

export function priorityOf(ticket) {
  if (ticket.severity === 1 || (ticket.severity === 2 && ticket.tier === 'contract')) return 'P1';
  if (ticket.severity === 2 || ticket.tier === 'priority') return 'P2';
  if (ticket.severity === 3) return 'P3';
  return 'P4';
}

export function redact(text) {
  return text.replace(CREDENTIAL, '[redacted]');
}

export function routeOne(ticket, intent, policy) {
  const blob = `${ticket.subject ?? ''}\n${ticket.body ?? ''}`;
  const credential = CREDENTIAL.test(blob);
  CREDENTIAL.lastIndex = 0;
  if (credential) return { queue: policy.credential.queue, responseMinutes: policy.credential.responseMinutes, credential: true, intentUnlisted: false };
  const row = policy.intents[intent];
  if (!row) return { queue: policy.default.queue, responseMinutes: policy.default.responseMinutes, credential: false, intentUnlisted: true };
  return { queue: row.queue, responseMinutes: row.responseMinutes, credential: false, intentUnlisted: false };
}

export function gateTriage(folder, contractPath, policyPath) {
  const bytes = readFileSync(contractPath);
  const contract = readJson(contractPath);
  const policy = readJson(policyPath);
  assertExactKeys(contract, ['items', 'origin', 'schema', 'source'], 'triage contract');
  assertOriginModel(contract, 'triage contract');
  if (contract.schema !== 'enterprise/triage-contract/1' || !Array.isArray(contract.items)) throw new Error('schema_invalid: items');
  if (policy.schema !== 'enterprise/sla-policy/1') throw new Error('schema_invalid: policy');
  const saved = loadPointedReturn(folder, contract.source, 'ticket source');
  const payload = JSON.parse(utf8FromBase64(saved.result));
  const tickets = Array.isArray(payload.tickets) ? payload.tickets : payload;
  const ranked = contract.items.map((item, index) => {
    assertExactKeys(item, ITEM_KEYS, `item ${index}`);
    const ticket = tickets.find((row) => row.id === item.id);
    if (!ticket) throw new Error(`schema_invalid: ${item.id} is not in the saved tickets`);
    const blob = `${ticket.subject ?? ''}\n${ticket.body ?? ''}`;
    assertVerbatim(item.quote, blob, item.id);
    const route = routeOne(ticket, item.intent, policy);
    return {
      id: item.id,
      intent: item.intent,
      quote: redact(item.quote),
      subject: redact(String(ticket.subject ?? '')),
      priority: priorityOf(ticket),
      ...route,
      evidenceId: saved.evidenceId,
      origin: 'script',
    };
  });
  const gate = { ok: true, origin: 'script', contractSha256: sha256(bytes), ranked };
  writeFileSync(join(folder, 'gate.json'), `${JSON.stringify(gate, null, 2)}\n`);
  return gate;
}

export function emitTriage(folder, contractPath) {
  const gate = readJson(join(folder, 'gate.json'));
  if (gate?.ok !== true) throw new Error('gate_not_passed');
  if (sha256(readFileSync(contractPath)) !== gate.contractSha256) throw new Error('contract_changed_after_gate');
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
    'Intent is model judgement. Queue, SLA, priority and the credential filter are a script.',
    '',
    ...gate.ranked.map((row) => `## ${row.id}\n\nintent ${row.intent} → ${row.queue} in ${row.responseMinutes} minutes (${row.priority})${row.credential ? '\n\nCredential filtered.' : ''}`),
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
