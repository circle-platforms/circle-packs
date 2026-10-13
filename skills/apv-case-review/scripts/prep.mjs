#!/usr/bin/env node
// Step 1: read a compiled batch and check the required structure.
//   node prep.mjs <batch folder>
// Reads cases/*.json and writes review_structure.json into the batch folder.
// Pure structure checks; no verdict on content.
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

// Deterministic structure checks per case. Each violation is {code, detail}.
export function checkStructure(item) {
  const violations = [];
  const flag = (code, detail) => violations.push({ code, detail });
  if (!item || typeof item !== 'object') return { violations: [{ code: 'not_an_object', detail: '' }], deviceCommands: [], clients: [] };
  if (typeof item.autoid !== 'string' || !/^\d{18}$/.test(item.autoid)) flag('autoid_invalid', String(item.autoid));
  const blocks = Array.isArray(item.blocks) ? item.blocks : [];
  if (!blocks.length) flag('blocks_empty', 'a case needs at least one block');
  let checkpoints = 0;
  const deviceCommands = [];
  const clients = [];
  for (const [index, block] of blocks.entries()) {
    const at = `block ${index}`;
    if (block?.kind === 'CONFIG') {
      if (!Array.isArray(block.cmds) || !block.cmds.length) flag('config_empty', at);
      for (const cmd of block.cmds ?? []) {
        if (typeof cmd !== 'string' || !cmd.trim()) flag('command_empty', at);
        else if (cmd.length > 2000) flag('command_too_long', at);
        else deviceCommands.push(cmd);
      }
    } else if (block?.kind === 'OBSERVE_ASSERT') {
      if (typeof block.cmd !== 'string' || !block.cmd.trim()) flag('observe_cmd_empty', at);
      else deviceCommands.push(block.cmd);
      checkpoints += (block.asserts ?? []).length;
      if (!(block.asserts ?? []).length) flag('observe_no_assert', at);
    } else if (block?.kind === 'CLIENT') {
      if (typeof block.client !== 'string' || !block.client.trim()) flag('client_empty', at);
      else clients.push(block.client);
      checkpoints += (block.asserts ?? []).length;
    }
  }
  if (!checkpoints) flag('no_checkpoint', 'a case needs at least one check_point');
  return { violations, deviceCommands, clients };
}

export function prepBatch(folder) {
  const cases = readBatch(folder);
  const results = {};
  cases.forEach((item, index) => {
    const key = typeof item?.autoid === 'string' && item.autoid ? item.autoid : `case#${index + 1}`;
    const { violations } = checkStructure(item);
    results[key] = { autoid: item?.autoid ?? null, ok: violations.length === 0, violations };
  });
  const report = { schema: 'apv.case-review.structure', folder, case_count: cases.length, fail_count: Object.values(results).filter((r) => !r.ok).length, cases: results };
  writeFileSync(join(folder, 'review_structure.json'), JSON.stringify(report, null, 2) + '\n');
  return report;
}

if (process.argv[1] && import.meta.url === `file://${process.argv[1]}`) {
  const [folder] = process.argv.slice(2);
  if (!folder) { console.error('usage: node prep.mjs <batch folder>'); process.exit(2); }
  const report = prepBatch(folder);
  console.log(JSON.stringify({ case_count: report.case_count, fail_count: report.fail_count }));
}
