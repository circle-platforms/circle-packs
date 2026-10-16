#!/usr/bin/env node
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { assertExactKeys, assertOriginModel, assertVerbatim, loadPointedReturn, readJson, sha256, sectionText } from './pointers.mjs';

export const REQUIRED = ['identity', 'equipment', 'accounts', 'policies', 'manager'];
const RULE_KEYS = ['effect', 'id', 'quote', 'role'];

export function checklistStatus(completed) {
  const done = new Set(completed);
  return REQUIRED.map((item) => ({ item, status: done.has(item) ? 'done' : 'missing', origin: 'script' }));
}

export function evaluateRole(role, rules) {
  const matched = rules.filter((rule) => rule.role === role);
  const forbid = matched.find((rule) => rule.effect === 'forbid');
  const permit = matched.find((rule) => rule.effect === 'permit');
  const decision = forbid ? 'forbid' : permit ? 'permit' : 'uncovered';
  return { decision, needsApproval: decision !== 'permit', ruleId: (forbid ?? permit)?.id ?? null, origin: 'script' };
}

export function gateOnboarding(folder, rulesPath) {
  const bytes = readFileSync(rulesPath);
  const contract = readJson(rulesPath);
  assertExactKeys(contract, ['origin', 'rules', 'schema', 'source'], 'policy rules');
  assertOriginModel(contract, 'policy rules');
  if (contract.schema !== 'enterprise/policy-rules/1' || !Array.isArray(contract.rules)) throw new Error('schema_invalid: rules');
  const saved = loadPointedReturn(folder, contract.source, 'policy source');
  const text = sectionText(saved.result);
  const rules = contract.rules.map((rule, index) => {
    assertExactKeys(rule, RULE_KEYS, `rule ${index}`);
    if (!['permit', 'forbid'].includes(rule.effect)) throw new Error(`schema_invalid: rule ${index} effect`);
    if (typeof rule.role !== 'string' || !/^[a-z0-9-]{1,40}$/.test(rule.role)) throw new Error(`schema_invalid: rule ${index} role`);
    assertVerbatim(rule.quote, text, rule.id);
    if (!rule.quote.includes(rule.role)) throw new Error(`quote_not_verbatim: ${rule.id} role is not inside the quote`);
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
  const access = (requests.requests ?? requests).map((request) => ({ ...request, ...evaluateRole(request.role, gate.rules) }));
  const lines = [
    '# Policy evaluation',
    '',
    'Rules are model extracts checked verbatim. The decision on each role is a script.',
    '',
    ...gate.rules.map((rule) => `- ${rule.effect} ${rule.role}: ${rule.quote}`),
    '',
    ...access.map((request) => `- ${request.role}: ${request.decision}`),
    '',
  ];
  mkdirSync(join(folder, 'out'), { recursive: true });
  writeFileSync(join(folder, 'out', 'checklist.json'), `${JSON.stringify(items, null, 2)}\n`);
  writeFileSync(join(folder, 'out', 'access_requests.json'), `${JSON.stringify(access, null, 2)}\n`);
  writeFileSync(join(folder, 'out', 'policy_answer.md'), lines.join('\n'));
  return { items, access };
}
