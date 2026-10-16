#!/usr/bin/env node
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { addCalendarDays, assertExactKeys, assertKeys, assertOriginModel, assertPolicyPin, assertQuoteAt, GateError, loadOriginal, parseQuantity, readJson, sha256 } from './pointers.mjs';

export const REQUIRED = ['identity', 'equipment', 'accounts', 'policies', 'manager'];
const ROLE = /^[\u3400-\u9fffA-Za-z0-9_:-]{1,40}$/;
const EFFECTS = ['permit', 'forbid', 'downgrade'];

export function checklistStatus(completed) {
  const done = new Set(completed);
  return REQUIRED.map((item) => ({ item, status: done.has(item) ? 'done' : 'missing', origin: 'script' }));
}

function tenureOf(value, label) {
  if (value == null) return null;
  assertExactKeys(value, ['unit', 'value'], label);
  if (!Number.isInteger(value.value) || value.value < 0 || value.value > 3650) throw new GateError('schema_invalid', label);
  if (value.unit !== 'day' && value.unit !== 'month') throw new GateError('schema_invalid', `${label} unit`);
  return value;
}

function checkRule(rule, text, index) {
  assertKeys(rule, ['effect', 'id', 'offset', 'quote', 'role'], ['after', 'approver', 'grant', 'kind', 'minTenure'], `rule ${index}`);
  if (!EFFECTS.includes(rule.effect)) throw new GateError('schema_invalid', `rule ${index} effect`);
  if (rule.kind != null && !['permit', 'forbid', 'obligation', 'term', 'definition'].includes(rule.kind)) throw new GateError('schema_invalid', `rule ${index} kind`);
  if (!ROLE.test(rule.role)) throw new GateError('schema_invalid', `rule ${index} role`);
  assertQuoteAt(text, rule.quote, rule.offset, rule.id);
  if (!rule.quote.includes(rule.role)) throw new GateError('quote_not_verbatim', `${rule.id} role`);
  const declared = tenureOf(rule.minTenure, `${rule.id} tenure`) ?? tenureOf(rule.after, `${rule.id} after`);
  if (rule.effect === 'downgrade') {
    if (!ROLE.test(rule.grant ?? '')) throw new GateError('schema_invalid', `rule ${index} grant`);
    if (!rule.quote.includes(rule.grant)) throw new GateError('quote_not_verbatim', `${rule.id} grant`);
    if (!rule.after) throw new GateError('schema_invalid', `rule ${index} after`);
  }
  if (rule.effect === 'permit' && rule.minTenure == null && rule.after != null) throw new GateError('schema_invalid', `rule ${index} after`);
  if (declared) {
    const parsed = parseQuantity(rule.quote);
    if (!parsed || parsed.value !== declared.value || parsed.unit !== declared.unit) throw new GateError('unit_mismatch', `${rule.id}: quote is ${parsed ? `${parsed.value} ${parsed.unit}` : 'not a quantity'}`);
  }
  if (rule.approver != null) {
    if (typeof rule.approver !== 'string' || !rule.approver || !rule.quote.includes(rule.approver)) throw new GateError('quote_not_verbatim', `${rule.id} approver`);
  }
  return { ...rule, evidenceId: null };
}

function conflict(rules) {
  const groups = new Map();
  for (const rule of rules) {
    const key = `${rule.offset}\0${rule.quote}`;
    const effects = groups.get(key) ?? new Set();
    effects.add(rule.effect);
    groups.set(key, effects);
  }
  for (const effects of groups.values()) {
    if (effects.has('permit') && effects.has('forbid')) throw new GateError('polarity_conflict', 'the same quote is both permit and forbid');
  }
}

export function compareExtracts(leftPath, rightPath) {
  const left = readJson(leftPath);
  const right = readJson(rightPath);
  for (const [label, contract] of [['left', left], ['right', right]]) {
    assertExactKeys(contract, ['origin', 'rules', 'schema', 'source'], label);
    assertOriginModel(contract, label);
    if (contract.schema !== 'enterprise/policy-rules/2' || !Array.isArray(contract.rules)) throw new GateError('schema_invalid', label);
  }
  const disagreements = [];
  const rightBy = new Map(right.rules.map((rule) => [rule.offset, rule]));
  for (const rule of left.rules) {
    const other = rightBy.get(rule.offset);
    const sameTenure = JSON.stringify(rule.minTenure ?? null) === JSON.stringify(other?.minTenure ?? null) && JSON.stringify(rule.after ?? null) === JSON.stringify(other?.after ?? null);
    if (!other || other.effect !== rule.effect || other.role !== rule.role || other.grant !== rule.grant || !sameTenure) {
      disagreements.push({ offset: rule.offset, left: rule.effect, right: other?.effect ?? null });
    }
  }
  return { ok: true, needsHuman: disagreements.length > 0, disagreements, origin: 'script' };
}

export function evaluateRole(request, rules) {
  const tenure = request.tenure ?? null;
  const matched = rules.filter((rule) => rule.role === request.role);
  const downgrade = matched.find((rule) => rule.effect === 'downgrade');
  const forbid = matched.find((rule) => rule.effect === 'forbid');
  const permit = matched.find((rule) => rule.effect === 'permit');
  const chosen = downgrade ?? forbid ?? permit;
  if (!chosen) return { decision: 'uncovered', needsApproval: true, ruleId: null, origin: 'script' };
  const waiting = chosen.after ?? chosen.minTenure ?? null;
  if (waiting && tenure && tenure.unit !== waiting.unit) throw new GateError('unit_mismatch', `${request.role} tenure unit`);
  const met = !waiting || (tenure != null && tenure.value >= waiting.value);
  let decision = chosen.effect;
  if (downgrade && !met) decision = 'not_yet';
  else if (permit && waiting && !met) decision = 'tenure_short';
  else if (forbid) decision = 'forbid';
  const grantDate = request.startDate && waiting?.unit === 'day' ? addCalendarDays(request.startDate, waiting.value) : request.startDate && !waiting ? request.startDate : null;
  return {
    decision,
    needsApproval: decision !== 'permit' && decision !== 'downgrade',
    ruleId: chosen.id,
    ...(chosen.grant && decision === 'downgrade' ? { grant: chosen.grant } : {}),
    ...(chosen.approver ? { approver: chosen.approver } : {}),
    ...(grantDate ? { grantDate } : {}),
    origin: 'script',
  };
}

export function gateOnboarding(folder, rulesPath, pinPath) {
  const bytes = readFileSync(rulesPath);
  assertPolicyPin(bytes, readJson(pinPath));
  const contract = readJson(rulesPath);
  assertExactKeys(contract, ['origin', 'rules', 'schema', 'source'], 'policy rules');
  if (contract.origin !== 'approved') throw new GateError('policy_not_approved', 'rules origin must be approved');
  if (contract.schema !== 'enterprise/policy-rules/2' || !Array.isArray(contract.rules)) throw new GateError('schema_invalid', 'rules');
  const saved = loadOriginal(folder, contract.source, 'policy source');
  const rules = contract.rules.map((rule, index) => ({ ...checkRule(rule, saved.text, index), evidenceId: saved.evidenceId }));
  conflict(rules);
  const gate = { ok: true, origin: 'script', rulesSha256: sha256(bytes), rules };
  writeFileSync(join(folder, 'gate.json'), `${JSON.stringify(gate, null, 2)}\n`);
  return gate;
}

export function emitOnboarding(folder, rulesPath, checklist, requests) {
  const gate = readJson(join(folder, 'gate.json'));
  if (gate?.ok !== true) throw new Error('gate_not_passed');
  if (sha256(readFileSync(rulesPath)) !== gate.rulesSha256) throw new Error('policy_changed_after_gate');
  const items = checklistStatus(checklist.completed ?? checklist);
  const access = (requests.requests ?? requests).map((request) => ({ ...request, ...evaluateRole(request, gate.rules) }));
  const lines = [
    '# Policy evaluation',
    '',
    'Rules are the pinned approved file. Tenure units, the grant date and the decision are a script.',
    '',
    ...gate.rules.map((rule) => `- ${rule.effect} ${rule.role}${rule.grant ? ` → ${rule.grant}` : ''}${rule.minTenure ? ` after ${rule.minTenure.value} ${rule.minTenure.unit}` : ''}${rule.after ? ` after ${rule.after.value} ${rule.after.unit}` : ''}${rule.approver ? ` approver ${rule.approver}` : ''}`),
    '',
    ...access.map((request) => `- ${request.role}: ${request.decision}${request.grant ? ` → ${request.grant}` : ''}${request.grantDate ? ` on ${request.grantDate}` : ''}${request.approver ? ` by ${request.approver}` : ''}`),
    '',
  ];
  mkdirSync(join(folder, 'out'), { recursive: true });
  writeFileSync(join(folder, 'out', 'checklist.json'), `${JSON.stringify(items, null, 2)}\n`);
  writeFileSync(join(folder, 'out', 'access_requests.json'), `${JSON.stringify(access, null, 2)}\n`);
  writeFileSync(join(folder, 'out', 'policy_answer.md'), lines.join('\n'));
  return { items, access };
}

function flags(argv) {
  const args = {};
  for (let i = 0; i < argv.length; i++) if (argv[i].startsWith('--')) args[argv[i].slice(2)] = argv[++i];
  return args;
}

if (process.argv[1] && import.meta.url === `file://${process.argv[1]}`) {
  const [folder, ...rest] = process.argv.slice(2);
  const args = flags(rest);
  if (folder && args.left && args.right && !args.rules) {
    writeFileSync(join(folder, 'compare.json'), `${JSON.stringify(compareExtracts(args.left, args.right), null, 2)}\n`);
  }
}
