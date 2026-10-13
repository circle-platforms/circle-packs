#!/usr/bin/env node
// Step 1: read a compiled batch and check the required structure.
//   node prep.mjs <batch folder>
// Reads cases/*.json and machine_mindmap.json, writes review_structure.json and
// review_context.json into the batch folder. Pure structure checks; no verdict on content.
import { readFileSync, readdirSync, existsSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

export function readBatch(folder) {
  const casesDir = join(folder, 'cases');
  const cases = [];
  if (existsSync(casesDir)) {
    for (const file of readdirSync(casesDir).filter((f) => f.endsWith('.json')).sort()) {
      const item = JSON.parse(readFileSync(join(casesDir, file), 'utf8'));
      cases.push(item);
    }
  }
  return cases;
}

const KNOWN_BLOCKS = new Set(['CONFIG', 'OBSERVE_ASSERT', 'CLIENT', 'SLEEP', 'STEP']);
const checkCommand = (cmd, at, flag, into) => {
  if (typeof cmd !== 'string' || !cmd.trim()) flag('command_empty', at);
  else if (cmd.length > 2000) flag('command_too_long', at);
  else if (/\n/.test(cmd)) flag('cmd_config_multiline', at);
  else into.push(cmd);
};

// Deterministic structure checks per case. Each violation is {code, detail}.
export function checkStructure(item) {
  const violations = [];
  const flag = (code, detail) => violations.push({ code, detail });
  if (!item || typeof item !== 'object') return { violations: [{ code: 'not_an_object', detail: '' }], deviceCommands: [], clients: [] };
  if (typeof item.autoid !== 'string' || !/^\d{18}$/.test(item.autoid)) flag('autoid_invalid', String(item.autoid));
  const deviceCommands = [];
  const clients = [];
  const init = Array.isArray(item.init_commands) ? item.init_commands : null;
  if (!init) flag('init_commands_invalid', 'a list of single-line commands');
  else for (const cmd of init) checkCommand(cmd, 'init_commands', flag, deviceCommands);
  const blocks = Array.isArray(item.blocks) ? item.blocks : [];
  if (!blocks.length) flag('blocks_empty', 'a case needs at least one block');
  let checkpoints = 0;
  for (const [index, block] of blocks.entries()) {
    const at = `block ${index}`;
    if (!KNOWN_BLOCKS.has(block?.kind)) { flag('block_unknown', `${at}: ${String(block?.kind)}`); continue; }
    if (block.kind === 'CONFIG') {
      if (!Array.isArray(block.cmds) || !block.cmds.length) flag('config_empty', at);
      for (const cmd of block.cmds ?? []) checkCommand(cmd, at, flag, deviceCommands);
    } else if (block.kind === 'OBSERVE_ASSERT') {
      if (typeof block.cmd !== 'string' || !block.cmd.trim()) flag('observe_cmd_empty', at);
      else deviceCommands.push(block.cmd);
      checkpoints += (block.asserts ?? []).length;
      if (!(block.asserts ?? []).length) flag('observe_no_assert', at);
    } else if (block.kind === 'CLIENT') {
      if (typeof block.client !== 'string' || !block.client.trim()) flag('client_empty', at);
      else clients.push(block.client);
      checkpoints += (block.asserts ?? []).length;
    }
  }
  if (!checkpoints) flag('no_checkpoint', 'a case needs at least one check_point');
  return { violations, deviceCommands, clients };
}

// The mindmap context the judgement step reads, projected from machine_mindmap.json as the
// compile skill's references/contract.md writes it: per case the contract triple, the
// expectations and the gap proposal.
export function readContext(folder) {
  const path = join(folder, 'machine_mindmap.json');
  if (!existsSync(path)) return null;
  const machine = JSON.parse(readFileSync(path, 'utf8'));
  const cases = Array.isArray(machine.cases) ? machine.cases : [];
  return {
    schema: 'apv.case-review.context',
    build: machine.build ?? null,
    display_build: machine.display_build ?? null,
    cases: cases.map((entry) => ({
      autoid: entry.autoid,
      group_path: entry.group_path ?? entry.description?.group_path ?? null,
      intent: entry.contract?.intent ?? null,
      verification: entry.contract?.verification_method ?? null,
      expectations: (entry.expectations ?? []).map((e) => ({ n: e.n, text: e.text, origin: e.origin })),
      proposal: entry.proposal ?? [],
    })),
  };
}

export function prepBatch(folder) {
  const cases = readBatch(folder);
  const results = {};
  const seen = new Map();
  cases.forEach((item, index) => {
    const key = typeof item?.autoid === 'string' && item.autoid ? item.autoid : `case#${index + 1}`;
    const { violations } = checkStructure(item);
    if (typeof item?.autoid === 'string' && seen.has(item.autoid)) {
      violations.push({ code: 'autoid_duplicate', detail: `${item.autoid} also at ${seen.get(item.autoid)}` });
    }
    seen.set(item?.autoid, key);
    results[key] = { autoid: item?.autoid ?? null, ok: violations.length === 0, violations };
  });
  const report = { schema: 'apv.case-review.structure', folder, case_count: cases.length, fail_count: Object.values(results).filter((r) => !r.ok).length, cases: results };
  writeFileSync(join(folder, 'review_structure.json'), JSON.stringify(report, null, 2) + '\n');
  const context = readContext(folder);
  if (context) writeFileSync(join(folder, 'review_context.json'), JSON.stringify(context, null, 2) + '\n');
  return report;
}

if (process.argv[1] && import.meta.url === `file://${process.argv[1]}`) {
  const [folder] = process.argv.slice(2);
  if (!folder) { console.error('usage: node prep.mjs <batch folder>'); process.exit(2); }
  const report = prepBatch(folder);
  console.log(JSON.stringify({ case_count: report.case_count, fail_count: report.fail_count }));
}
