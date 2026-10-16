#!/usr/bin/env node
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { assertExactKeys, assertOriginModel, assertPolarity, assertVerbatim, loadOriginal, readJson, sha256 } from './pointers.mjs';

export const REQUIRED = ['identity', 'equipment', 'accounts', 'policies', 'manager'];
const ROLE = /^[\u3400-\u9fffA-Za-z0-9_-]{1,40}$/;
const PERMIT_KEYS = ['cue', 'effect', 'id', 'quote', 'role'];
const TENURE_KEYS = ['cue', 'effect', 'id', 'minTenureMonths', 'quote', 'role'];
const FORBID_KEYS = ['cue', 'effect', 'id', 'quote', 'role'];
const DOWNGRADE_KEYS = ['cue', 'effect', 'grant', 'id', 'quote', 'role'];

export function checklistStatus(completed) {
  const done = new Set(completed);
  return REQUIRED.map((item) => ({ item, status: done.has(item) ? 'done' : 'missing', origin: 'script' }));
}

export function evaluateRole(request, rules) {
  const matched = rules.filter((rule) => rule.role === request.role);
  const downgrade = matched.find((rule) => rule.effect === 'downgrade');
  const forbid = matched.find((rule) => rule.effect === 'forbid');
  const permit = matched.find((rule) => rule.effect === 'permit');
  if (downgrade) return { decision: 'downgrade', grant: downgrade.grant, needsApproval: false, ruleId: downgrade.id, origin: 'script' };
  if (forbid) return { decision: 'forbid', needsApproval: true, ruleId: forbid.id, origin: 'script' };
  if (permit) {
    if (permit.minTenureMonths != null && (request.tenureMonths ?? 0) < permit.minTenureMonths) {
      return { decision: 'tenure_short', needsApproval: true, ruleId: permit.id, minTenureMonths: permit.minTenureMonths, origin: 'script' };
    }
    return { decision: 'permit', needsApproval: false, ruleId: permit.id, origin: 'script' };
  }
  return { decision: 'uncovered', needsApproval: true, ruleId: null, origin: 'script' };
}

export function gateOnboarding(folder, rulesPath) {
  const bytes = readFileSync(rulesPath);
  const contract = readJson(rulesPath);
  assertExactKeys(contract, ['origin', 'rules', 'schema', 'source'], 'policy rules');
  assertOriginModel(contract, 'policy rules');
  if (contract.schema !== 'enterprise/policy-rules/1' || !Array.isArray(contract.rules)) throw new Error('schema_invalid: rules');
  const saved = loadOriginal(folder, contract.source, 'policy source');
  const rules = contract.rules.map((rule, index) => {
    if (!rule || typeof rule !== 'object') throw new Error(`schema_invalid: rule ${index}`);
    if (rule.effect === 'permit' && rule.minTenureMonths != null) assertExactKeys(rule, TENURE_KEYS, `rule ${index}`);
    else if (rule.effect === 'permit') assertExactKeys(rule, PERMIT_KEYS, `rule ${index}`);
    else if (rule.effect === 'forbid') assertExactKeys(rule, FORBID_KEYS, `rule ${index}`);
    else if (rule.effect === 'downgrade') assertExactKeys(rule, DOWNGRADE_KEYS, `rule ${index}`);
    else throw new Error(`schema_invalid: rule ${index} effect`);
    if (!ROLE.test(rule.role)) throw new Error(`schema_invalid: rule ${index} role`);
    assertVerbatim(rule.quote, saved.text, rule.id);
    if (!rule.quote.includes(rule.role)) throw new Error(`quote_not_verbatim: ${rule.id} role is not inside the quote`);
    assertPolarity(rule.quote, rule.cue, rule.effect, rule.id);
    if (rule.effect === 'permit' && rule.minTenureMonths != null) {
      if (!Number.isInteger(rule.minTenureMonths) || rule.minTenureMonths < 0 || rule.minTenureMonths > 600) throw new Error(`schema_invalid: rule ${index} tenure`);
      if (!rule.quote.includes(String(rule.minTenureMonths))) throw new Error(`quote_not_verbatim: ${rule.id} tenure is not inside the quote`);
    }
    if (rule.effect === 'downgrade') {
      if (!ROLE.test(rule.grant)) throw new Error(`schema_invalid: rule ${index} grant`);
      if (!rule.quote.includes(rule.grant)) throw new Error(`quote_not_verbatim: ${rule.id} grant is not inside the quote`);
    }
    return { ...rule, evidenceId: saved.evidenceId };
  });
  const gate = { ok: true, origin: 'script', contractSha256: sha256(bytes), rules };
  writeFileSync(join(folder, 'gate.json'), `${JSON.stringify(gate, null, 2)}\n`);
  return gate;
}

export function emitOnboarding(folder, rulesPath, checklist, requests) {
  const gate = readJson(join(folder, 'gate.json'));
  if (gate?.ok !== true) throw new Error('gate_not_passed');
  if (sha256(readFileSync(rulesPath)) !== gate.contractSha256) throw new Error('contract_changed_after_gate');
  const items = checklistStatus(checklist.completed ?? checklist);
  const access = (requests.requests ?? requests).map((request) => ({ ...request, ...evaluateRole(request, gate.rules) }));
  const lines = [
    '# Policy evaluation',
    '',
    'Rules are model extracts checked verbatim. Tenure, downgrade and the decision on each role are a script.',
    '',
    ...gate.rules.map((rule) => `- ${rule.effect} ${rule.role}${rule.grant ? ` → ${rule.grant}` : ''}${rule.minTenureMonths != null ? ` after ${rule.minTenureMonths} months` : ''}: ${rule.quote}`),
    '',
    ...access.map((request) => `- ${request.role}: ${request.decision}${request.grant ? ` → ${request.grant}` : ''}`),
    '',
  ];
  mkdirSync(join(folder, 'out'), { recursive: true });
  writeFileSync(join(folder, 'out', 'checklist.json'), `${JSON.stringify(items, null, 2)}\n`);
  writeFileSync(join(folder, 'out', 'access_requests.json'), `${JSON.stringify(access, null, 2)}\n`);
  writeFileSync(join(folder, 'out', 'policy_answer.md'), lines.join('\n'));
  return { items, access };
}
