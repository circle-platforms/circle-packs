#!/usr/bin/env node
// Step 4: the mechanical checks on each written case (cases/<autoid>.json) before any
// workbook is made. A case passes only with no violation; a command the build's command
// tree does not have ends the case as an unsupported feature, never as something to retry.
//   node gate.mjs <batch folder>
import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { readJson, writeJson } from './lib.mjs';
import { expectationIds } from './check-recompose.mjs';
import { loadBedFacts, deriveFacts, checkCase, applyBindings, validateBindings } from './bed-facts.mjs';

const KEYS = ['autoid', 'blocks', 'build', 'command_receipts', 'description', 'escape_hatches', 'expectation_binding', 'init_commands', 'schema'];
const HOSTS = new Set(['APV_0', 'APV_1']);
const OPS = new Set(['found', 'not_found', 'abs_found']);
const CLAIMS = new Set(['Author', 'Manual', 'CapabilityXml', 'Spec', 'DefectSpec']);
const STEP_OBJECTS = new Set(['APV_0', 'APV_1', 'check_point', 'time', 'test_env']);

// The receipts the server returned for this case, projected from the raw command_check
// result that the SERVER saved verbatim under .circle/hub-returns/. checks/<autoid>.json
// is only a pointer {"savedAs": "<path>"}: the model never transcribes a response, and this
// gate loads the verbatim file, checks it is a check of this build that covers exactly the
// case's device commands, and re-derives the receipts from it.
export function projectReceipts(raw) {
  const result = raw?.result;
  if (!result || !Array.isArray(result.commands)) return null;
  const evidenceId = raw?.evidence?.[0]?.evidenceId;
  return result.commands.map((entry) => ({
    command: entry.command,
    build: result.build,
    status: entry.status,
    head: entry.head ?? null,
    violations: entry.violations ?? [],
    ...(evidenceId ? { evidenceId } : {}),
  }));
}

// Load the raw check a case points at. The pointer file holds {"savedAs": "<path>"}.
export function loadRawCheck(pointerPath, caseCommands) {
  const problems = [];
  if (!existsSync(pointerPath)) return { raw: null, problems: [{ code: 'command_check_not_saved', detail: 'no checks/<autoid>.json pointer' }] };
  let pointer;
  try {
    pointer = JSON.parse(readFileSync(pointerPath, 'utf8'));
  } catch {
    return { raw: null, problems: [{ code: 'command_check_not_saved', detail: 'unreadable pointer file' }] };
  }
  if (typeof pointer.savedAs !== 'string' || !pointer.savedAs.trim())
    return { raw: null, problems: [{ code: 'command_check_not_saved', detail: 'pointer must be {"savedAs": "<server-returns path>"}' }] };
  const candidates = [pointer.savedAs, resolve(dirname(pointerPath), '..', '..', pointer.savedAs)];
  const path = candidates.find((p) => existsSync(p));
  if (!path) return { raw: null, problems: [{ code: 'command_check_not_saved', detail: `${pointer.savedAs}: server-saved raw not found` }] };
  let raw;
  try {
    const saved = JSON.parse(readFileSync(path, 'utf8'));
    // the server saves {tool, args, at, response: {result, evidence}}; older shapes had {result}
    raw = saved.response ?? saved;
  } catch {
    return { raw: null, problems: [{ code: 'command_check_not_saved', detail: `${pointer.savedAs}: unreadable` }] };
  }
  const checked = (raw?.result?.commands ?? []).map((entry) => entry.command);
  const wanted = [...new Set(caseCommands)];
  const sameSet = checked.length === wanted.length && [...checked].sort().join('\u0000') === [...wanted].sort().join('\u0000');
  if (!sameSet)
    problems.push({ code: 'command_check_does_not_cover', detail: `${pointer.savedAs} checked ${checked.length} commands, the case runs ${wanted.length}` });
  return { raw, problems };
}

// The client names a workbook may dispatch to: the enabled test_env methods of the execution
// side's Excel function contract (schema ist.excel.function-contract). The contract is data
// the user registers with the server; the skill reads it, it never keeps its own list.
export function contractClients(contractPath) {
  const contract = JSON.parse(readFileSync(contractPath, 'utf8'));
  if (contract?.schema !== 'ist.excel.function-contract' || !Array.isArray(contract.entries))
    throw new Error(`${contractPath}: not an Excel function contract`);
  return new Set(contract.entries.filter((entry) => entry.e === 'test_env' && entry.status === 'enabled').map((entry) => entry.f));
}

const here = dirname(fileURLToPath(import.meta.url));
export function destructivePatterns() {
  const path = join(here, '..', 'references', 'destructive.json');
  return existsSync(path) ? JSON.parse(readFileSync(path, 'utf8')).patterns.map((p) => new RegExp(p, 'i')) : [];
}

// Every device command a case runs: init, CONFIG and observation commands.
export function deviceCommands(item) {
  const commands = [...(item.init_commands ?? [])];
  for (const block of item.blocks ?? []) {
    if (block.kind === 'CONFIG') commands.push(...(block.cmds ?? []));
    if (block.kind === 'OBSERVE_ASSERT') commands.push(block.cmd);
  }
  return commands.filter((command) => typeof command === 'string');
}

export function gateCase(item, entry, manifestCase, build, destructive = destructivePatterns(), rawCheck = null, clients = null) {
  const violations = [];
  const flag = (code, detail) => violations.push({ code, detail });
  if (!item || typeof item !== 'object') return { ok: false, terminal: null, violations: [{ code: 'not_an_object', detail: '' }] };
  const keys = Object.keys(item).sort();
  if (keys.join() !== KEYS.join()) flag('body_keys_mismatch', `keys must be ${KEYS.join(', ')}`);
  if (item.schema !== 'apv.mechanical-case') flag('schema_invalid', String(item.schema));
  if (item.description?.intent_verbatim !== entry.contract?.intent) flag('intent_verbatim_mismatch', 'copy the recomposed intent byte for byte');
  if (JSON.stringify(item.description?.group_path) !== JSON.stringify(manifestCase.group_path)) flag('group_path_mismatch', 'copy the manifest group path');
  if (item.build !== build) flag('build_mismatch', `written for ${String(item.build)}, bound to ${build}`);
  if (!Array.isArray(item.init_commands) || item.init_commands.some((c) => typeof c !== 'string' || !c.trim() || /\n/.test(c)))
    flag('init_commands_invalid', 'a list of single-line commands');
  const blocks = Array.isArray(item.blocks) ? item.blocks : [];
  if (!blocks.length || blocks.length > 1024) flag('blocks_invalid', '1 to 1024 blocks');
  const asserts = [];
  const steps = [];
  let unsupportedClient = false;
  blocks.forEach((block, index) => {
    const at = `block ${index}`;
    if (block?.kind === 'CONFIG') {
      if (!HOSTS.has(block.host ?? 'APV_0')) flag('host_invalid', at);
      const cmds = block.cmds;
      if (!Array.isArray(cmds) || !cmds.length || cmds.some((c) => typeof c !== 'string' || !c.trim()))
        flag('empty_command_payload', at);
      else if (cmds.length > 1 && cmds.every((c) => c.length === 1)) flag('cmds_split_into_characters', at);
      else if (cmds.some((c) => /\n/.test(c))) flag('cmd_config_multiline', `${at}: one command per item`);
      if (block.timeout_s !== undefined && !(Number.isInteger(block.timeout_s) && block.timeout_s >= 1 && block.timeout_s <= 600))
        flag('timeout_invalid', at);
    } else if (block?.kind === 'OBSERVE_ASSERT') {
      if (!HOSTS.has(block.host ?? 'APV_0')) flag('host_invalid', at);
      if (typeof block.cmd !== 'string' || !block.cmd.trim() || /\n/.test(block.cmd)) flag('observe_command_invalid', at);
      if (!Array.isArray(block.asserts) || !block.asserts.length) flag('no_assertion_in_block', at);
      (block.asserts ?? []).forEach((check, assertIndex) => {
        if (!OPS.has(check?.op)) flag('assert_operator_invalid', `${at}.${assertIndex}`);
        if (typeof check?.pattern !== 'string' || !check.pattern) flag('empty_assertion_pattern', `${at}.${assertIndex}`);
        else if (check.op !== 'abs_found')
          try {
            new RegExp(check.pattern);
          } catch {
            flag('assertion_regex_invalid', `${at}.${assertIndex}`);
          }
        asserts.push({ id: check?.expectation_id, block: index, index: assertIndex });
      });
    } else if (block?.kind === 'CLIENT') {
      // A command on a test-env client (routera and friends): E=test_env, F=<client>.
      // Not a device command, so it never reaches the command tree or a receipt.
      if (typeof block.client !== 'string' || !block.client.trim()) flag('client_invalid', at);
      else if (clients === null) flag('client_not_checked', `${at}: ${block.client}: give the Excel function contract (--contract) to check client names`);
      else if (!clients.has(block.client)) {
        flag('client_not_in_contract', `${at}: ${block.client} is not an enabled test_env method of the contract`);
        unsupportedClient = true;
      }
      if (typeof block.cmd !== 'string' || !block.cmd.trim() || /\n/.test(block.cmd)) flag('client_command_invalid', at);
      // a CLIENT block may be traffic-only: its evidence is asserted device-side
      if (block.asserts !== undefined && !Array.isArray(block.asserts)) flag('no_assertion_in_block', at);
      (block.asserts ?? []).forEach((check, assertIndex) => {
        if (!OPS.has(check?.op)) flag('assert_operator_invalid', `${at}.${assertIndex}`);
        if (typeof check?.pattern !== 'string' || !check.pattern) flag('empty_assertion_pattern', `${at}.${assertIndex}`);
        else if (check.op !== 'abs_found')
          try {
            new RegExp(check.pattern);
          } catch {
            flag('assertion_regex_invalid', `${at}.${assertIndex}`);
          }
        asserts.push({ id: check?.expectation_id, block: index, index: assertIndex });
      });
    } else if (block?.kind === 'SLEEP') {
      if (!(Number.isInteger(block.seconds) && block.seconds >= 1 && block.seconds <= 300)) flag('sleep_invalid', `${at}: 1 to 300 seconds`);
    } else if (block?.kind === 'STEP') {
      steps.push(index);
      if (!block.desc || !STEP_OBJECTS.has(block.E) || !block.F) flag('step_row_invalid', `${at}: desc, E and F`);
    } else flag('block_kind_unknown', `${at}: ${String(block?.kind)}`);
  });
  if (!asserts.length) flag('no_assertion_in_case', 'a case needs at least one check_point');
  const hatches = (item.escape_hatches ?? []).map((h) => h?.block_index).sort((a, b) => a - b);
  if (JSON.stringify(hatches) !== JSON.stringify(steps)) flag('escape_hatch_mismatch', 'one escape hatch for each STEP block, with a reason');
  // Each expectation of the recomposed case is asserted exactly once, and bound to that assert.
  const wanted = expectationIds(entry);
  const asserted = asserts.map((a) => a.id);
  const bindings = Array.isArray(item.expectation_binding) ? item.expectation_binding : [];
  if ([...asserted].sort().join() !== [...wanted].sort().join() || new Set(asserted).size !== asserted.length)
    flag('expectation_bijection_failed', `asserts must carry exactly ${wanted.join(', ')}`);
  for (const binding of bindings) {
    const target = asserts.find((a) => a.block === binding?.block_index && a.index === binding?.assert_index);
    if (!target || target.id !== binding?.expectation_id) flag('binding_target_invalid', String(binding?.expectation_id));
    if (!CLAIMS.has(binding?.claim_kind)) flag('claim_kind_invalid', String(binding?.expectation_id));
  }
  if (bindings.map((b) => b?.expectation_id).sort().join() !== [...wanted].sort().join())
    flag('expectation_binding_incomplete', 'bind every expectation id once');
  // Commands: each needs the server's verdict for this build; a miss is final.
  const projected = rawCheck === null ? null : projectReceipts(rawCheck);
  if (projected === null) flag('command_check_not_saved', `save the buildsite.command_check result for this case to checks/${item.autoid}.json`);
  else if (JSON.stringify(item.command_receipts ?? []) !== JSON.stringify(projected))
    flag('receipt_not_from_server', 'command_receipts must be the exact projection of checks/<autoid>.json; never written by hand');
  let terminal = unsupportedClient ? 'unsupported_feature' : null;
  const receipts = new Map((item.command_receipts ?? []).map((receipt) => [receipt?.command, receipt]));
  for (const command of deviceCommands(item)) {
    if (destructive.some((pattern) => pattern.test(command))) flag('destructive_command', command);
    const receipt = receipts.get(command);
    if (!receipt) flag('command_unverified', `${command}: check it with buildsite.command_check for ${build}`);
    else if (receipt.build !== undefined && receipt.build !== build) flag('command_receipt_other_build', command);
    else if (receipt.status === 'missing') {
      flag('command_not_in_tree', `${command}: ${build} has no such command`);
      terminal = 'unsupported_feature';
    } else if (receipt.status !== 'hit') flag('command_unverified', command);
    else if ((receipt.violations ?? []).length)
      flag('command_parameter_contract', `${command}: ${receipt.violations.map((v) => (typeof v === 'string' ? v : v?.code ?? JSON.stringify(v))).join(', ')}`);
  }
  return { ok: violations.length === 0, terminal, violations };
}

// The bed-facts gate: without --bed-facts, or with an unusable facts file, the whole
// batch is refused (bed_facts_unavailable) — the check never folds into a pass.
export function gateBatch(batch, { contract = null, bedFactsPath = null } = {}) {
  const manifest = readJson(join(batch, 'manifest.json'));
  const machine = readJson(join(batch, 'machine_mindmap.json'));
  const destructive = destructivePatterns();
  const clients = contract ? contractClients(contract) : null;
  const bed = bedFactsPath === null ? { ok: false, reason: 'not provided' } : loadBedFacts(bedFactsPath, { readFileSync });
  const facts = bed.ok ? deriveFacts(bed) : null;
  const refuseAll = (detail) => {
    const results = {};
    for (const manifestCase of manifest.cases)
      results[manifestCase.autoid] = { ok: false, status: 'rejected', violations: [{ code: 'bed_facts_unavailable', detail }] };
    return {
      schema: 'apv.mindmap-compile.gate-report',
      source_sha256: manifest.source_sha256,
      build: machine.build,
      display_build: machine.display_build ?? machine.build,
      contract_sha256: null,
      bed_facts: null,
      cases: results,
    };
  };
  if (!facts) return refuseAll(bedFactsPath === null ? '--bed-facts is required' : `bed facts ${bedFactsPath}: ${bed.reason}`);
  // Confirmed bindings: validated against the batch, then applied per case before the
  // checks; a binding whose from is missing or whose pair is broken is a hard refusal.
  const bindingsPath = join(batch, 'bindings.json');
  const bindings = existsSync(bindingsPath) ? readJson(bindingsPath) : [];
  const bindingsSha256 = bindings.length ? createHash('sha256').update(readFileSync(bindingsPath)).digest('hex') : null;
  const caseOf = (autoid) => {
    const path = join(batch, 'cases', `${autoid}.json`);
    return existsSync(path) ? readJson(path) : null;
  };
  const bindingProblems = bindings.length ? validateBindings(bindings, caseOf) : [];
  const bindingProblemsFor = (autoid) => bindingProblems.filter((p) => p.autoid === autoid);
  if (bindingProblems.length)
    return refuseAll(`bindings.json invalid: ${bindingProblems.map((p) => `${p.autoid}: ${p.detail}`).join('; ')}`);
  // Author-verbatim disclosure needs the source text the batch was compiled from.
  const sourcePath = join(batch, '..', manifest.source);
  const sourceText = existsSync(sourcePath) ? readFileSync(sourcePath, 'utf8') : '';
  const proposals = [];
  const results = {};
  for (const manifestCase of manifest.cases) {
    const entry = machine.cases.find((c) => c.autoid === manifestCase.autoid);
    const path = join(batch, 'cases', `${manifestCase.autoid}.json`);
    if (!entry) results[manifestCase.autoid] = { ok: false, status: 'not_recomposed', violations: [] };
    else if (entry.bucket === 'true_gap')
      results[manifestCase.autoid] = { ok: false, status: 'needs_decision', violations: [{ code: 'source_incomplete', detail: (entry.proposal ?? []).join(' / ') }] };
    else if (!existsSync(path)) results[manifestCase.autoid] = { ok: false, status: 'not_written', violations: [] };
    else {
      const checkPath = join(batch, 'checks', `${manifestCase.autoid}.json`);
      const item = readJson(path);
      const deviceCommandsList = deviceCommands(item);
      const { raw: rawCheck, problems: checkProblems } = existsSync(checkPath)
        ? loadRawCheck(checkPath, deviceCommandsList)
        : { raw: null, problems: [{ code: 'command_check_not_saved', detail: `save the buildsite.command_check result for this case to checks/${manifestCase.autoid}.json` }] };
      const result = gateCase(item, entry, manifestCase, machine.build, destructive, rawCheck, clients);
      result.violations.push(...checkProblems);
      if (checkProblems.length) result.ok = false;
      // Bed-facts mechanical checks a–g; binding proposals are recorded, never applied
      // here. Confirmed bindings (batch/bindings.json) are validated and applied before
      // the checks, so a bound case is judged on the bound data.
      let effectiveItem = item;
      const caseBindings = bindings.filter((b) => b.autoid === manifestCase.autoid);
      if (caseBindings.length && !bindingProblemsFor(manifestCase.autoid).length)
        effectiveItem = applyBindings(item, caseBindings).item;
      const { violations: bedViolations, proposals: caseProposals } = checkCase(effectiveItem, facts, sourceText);
      const blocks = bedViolations.filter((v) => v.severity === 'block');
      const warns = bedViolations.filter((v) => v.severity === 'warn');
      result.violations.push(...blocks.map((v) => ({ code: v.code, detail: `${v.detail}${v.suggestion ? `;建议绑定 ${v.suggestion}` : ''}${v.pairedHosts ? `;同段触发机: ${v.pairedHosts.join(',')}` : ''}`, literal: v.literal, command: v.command })));
      result.violations.push(...warns.map((v) => ({ code: v.code, detail: v.detail, literal: v.literal, command: v.command })));
      if (blocks.length) {
        result.ok = false;
        // Terminal status by origin: an underdetermined data gap (compile-time literal,
        // missing upstream) outranks a verbatim environment disclosure; anything else is
        // a compile error. Neither status produces a workbook.
        result.terminal = blocks.some((v) => v.category === 'underdetermined')
          ? 'underdetermined'
          : blocks.every((v) => v.category === 'environment') ? 'environment_disclosure' : 'rejected';
      }
      proposals.push(...caseProposals);
      results[manifestCase.autoid] = { ...result, status: result.ok ? 'gated' : (result.terminal ?? 'rejected') };
    }
  }
  const report = {
    schema: 'apv.mindmap-compile.gate-report',
    source_sha256: manifest.source_sha256,
    build: machine.build,
    display_build: machine.display_build ?? machine.build,
    contract_sha256: contract ? createHash('sha256').update(readFileSync(contract)).digest('hex') : null,
    bed_facts: bedFactsPath,
    ...(bindings.length ? { applied_bindings: { sha256: bindingsSha256, bindings } } : {}),
    cases: results,
  };
  writeJson(join(batch, 'bindings.proposed.json'), proposals);
  return report;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const args = process.argv.slice(2);
  const at = args.indexOf('--contract');
  const contract = at >= 0 ? args[at + 1] : null;
  const bf = args.indexOf('--bed-facts');
  const bedFacts = bf >= 0 ? args[bf + 1] : null;
  const skip = new Set([at, at + 1, bf, bf + 1]);
  const [batch] = args.filter((_, i) => !skip.has(i));
  if (!batch || !bedFacts) {
    console.error('usage: node gate.mjs <batch folder> --bed-facts <gateway.topology evidence> [--contract <excel function contract>]');
    process.exit(2);
  }
  const report = gateBatch(batch, { contract, bedFactsPath: bedFacts });
  writeJson(join(batch, 'gate_report.json'), report);
  const counts = {};
  for (const result of Object.values(report.cases)) counts[result.status] = (counts[result.status] ?? 0) + 1;
  console.log(JSON.stringify({ counts, rejected: Object.entries(report.cases).filter(([, r]) => !r.ok && r.violations.length).map(([id, r]) => ({ autoid: id, violations: r.violations.slice(0, 8) })) }));
}
