#!/usr/bin/env node
// Step 1: read a compiled batch and check the required structure.
//   node prep.mjs <batch folder>
// Reads cases/*.json and machine_mindmap.json, writes review_structure.json and
// review_context.json into the batch folder. Pure structure checks; no verdict on content.
import { readFileSync, readdirSync, existsSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

// A case file that is not valid JSON is reported as case_unreadable; the rest of the
// batch still reviews.
export function readBatch(folder) {
  const casesDir = join(folder, 'cases');
  const cases = [];
  const unreadable = [];
  if (existsSync(casesDir)) {
    for (const file of readdirSync(casesDir).filter((f) => f.endsWith('.json')).sort()) {
      try {
        cases.push(JSON.parse(readFileSync(join(casesDir, file), 'utf8')));
      } catch {
        unreadable.push(file);
      }
    }
  }
  return { cases, unreadable };
}

// The block kinds gate.mjs accepts; anything else is block_unknown — no exceptions.
const KNOWN_BLOCKS = new Set(['CONFIG', 'OBSERVE_ASSERT', 'CLIENT', 'SLEEP', 'STEP']);
const checkCommand = (cmd, at, flag, into) => {
  if (typeof cmd !== 'string' || !cmd.trim()) flag('command_empty', at);
  else if (cmd.length > 2000) flag('command_too_long', at);
  else if (/\n/.test(cmd)) flag('cmd_config_multiline', at);
  else into.push(cmd);
};

// Deterministic structure checks per case. Each violation is {code, detail}. Only commands
// that pass the checks enter deviceCommands, so collect hands the hub nothing structurally
// invalid.
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
      checkCommand(block.cmd, at, flag, deviceCommands);
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

// The mindmap context the judgement step reads: per case the bucket, the contract triple,
// the per-step expectations and the gap proposal — projected from machine_mindmap.json as
// the compile skill's references/contract.md writes it — with group_path taken from the
// case file's description.group_path (the machine entries carry none).
export function readContext(folder, batchCases) {
  const path = join(folder, 'machine_mindmap.json');
  if (!existsSync(path)) return null;
  const machine = JSON.parse(readFileSync(path, 'utf8'));
  const cases = Array.isArray(machine.cases) ? machine.cases : [];
  return {
    schema: 'apv.case-review.context',
    build: machine.build ?? null,
    display_build: machine.display_build ?? null,
    cases: cases.map((entry) => {
      const batchCase = batchCases.find((c) => c?.autoid === entry.autoid);
      return {
        autoid: entry.autoid,
        bucket: entry.bucket ?? null,
        group_path: batchCase?.description?.group_path ?? null,
        intent: entry.contract?.intent ?? null,
        verification: entry.contract?.verification_method ?? null,
        expectation: entry.contract?.expectation ?? null,
        expectations: (entry.expectations ?? []).map((e) => ({ n: e.n, text: e.text, origin: e.origin })),
        proposal: entry.proposal ?? [],
      };
    }),
  };
}

export function prepBatch(folder) {
  const { cases, unreadable } = readBatch(folder);
  const entries = [];
  const occurrences = new Map();
  cases.forEach((item, index) => {
    const autoid = typeof item?.autoid === 'string' && item.autoid ? item.autoid : null;
    const key = autoid ?? `case#${index + 1}`;
    const n = (occurrences.get(key) ?? 0) + 1;
    occurrences.set(key, n);
    const { violations } = checkStructure(item);
    entries.push({ key: n === 1 ? key : `${key}#${n}`, autoid, violations });
  });
  const results = {};
  for (const entry of entries) {
    if ((occurrences.get(entry.autoid ?? '') ?? 0) > 1) entry.violations.push({ code: 'autoid_duplicate', detail: `${entry.autoid} occurs ${occurrences.get(entry.autoid)} times` });
    results[entry.key] = { autoid: entry.autoid, ok: entry.violations.length === 0, violations: entry.violations };
  }
  for (const file of unreadable) results[`unreadable:${file}`] = { autoid: null, ok: false, violations: [{ code: 'case_unreadable', detail: file }] };
  const report = { schema: 'apv.case-review.structure', folder, case_count: cases.length, fail_count: Object.values(results).filter((r) => !r.ok).length, cases: results };
  writeFileSync(join(folder, 'review_structure.json'), JSON.stringify(report, null, 2) + '\n');
  const context = readContext(folder, cases);
  if (context) writeFileSync(join(folder, 'review_context.json'), JSON.stringify(context, null, 2) + '\n');
  return report;
}

if (process.argv[1] && import.meta.url === `file://${process.argv[1]}`) {
  const [folder] = process.argv.slice(2);
  if (!folder) { console.error('usage: node prep.mjs <batch folder>'); process.exit(2); }
  const report = prepBatch(folder);
  console.log(JSON.stringify({ case_count: report.case_count, fail_count: report.fail_count }));
}
