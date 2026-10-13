#!/usr/bin/env node
// Step 2: deterministic command and contract checks.
//   node check.mjs collect <batch>            print the deduped device commands (with their
//                                             source autoids) and the client names, to pass
//                                             verbatim to srv_buildsite_command_check
//   node check.mjs apply <batch> --build <id> --check <file> [--check <file>…] [--contract <Excel
//                                             function contract>]   write review_commands.json
// Each --check is either a hub-saved command_check return or a checks/<autoid>.json pointer
// {"savedAs": "<path>"} as the compile skill leaves them; the pointer resolves as given,
// then relative to the workspace root (pointer dir /../..), then relative to the batch
// folder — the gate.mjs candidates plus the batch. The model never transcribes a hub
// response: apply loads the saved files itself, merges their result.commands, and takes
// each command's evidenceId from the return that contains it.
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join, resolve, dirname } from 'node:path';
import { readBatch, checkStructure } from './prep.mjs';

// The enabled test_env clients of the execution side's Excel function contract.
export function contractClients(contractPath) {
  const contract = JSON.parse(readFileSync(contractPath, 'utf8'));
  if (contract?.schema !== 'ist.excel.function-contract' || !Array.isArray(contract.entries))
    throw new Error(`${contractPath}: not an Excel function contract`);
  return new Set(contract.entries.filter((entry) => entry.e === 'test_env' && entry.status === 'enabled').map((entry) => entry.f));
}

// What the batch asks for: deduped device commands (each with the autoids that use it) and
// the client names, in first-seen order. Structurally invalid commands (empty, multiline,
// over-long) never reach the hub: checkStructure already rejected them into findings.
export function collectBatch(folder) {
  const commands = new Map();
  const clients = new Map();
  for (const item of readBatch(folder).cases) {
    const { deviceCommands, clients: caseClients } = checkStructure(item);
    for (const command of deviceCommands) {
      if (!commands.has(command)) commands.set(command, []);
      const list = commands.get(command);
      if (!list.includes(item.autoid)) list.push(item.autoid);
    }
    for (const client of caseClients) {
      if (!clients.has(client)) clients.set(client, []);
      const list = clients.get(client);
      if (!list.includes(item.autoid)) list.push(item.autoid);
    }
  }
  return {
    commands: [...commands.entries()].map(([command, autoids]) => ({ command, autoids })),
    clients: [...clients.entries()].map(([client, autoids]) => ({ client, autoids })),
  };
}

// Load one --check argument: a hub-saved return {tool, args, at, response:{result, evidence}}
// (older: {result}), or a pointer {"savedAs": "<path>"} resolved with the gate.mjs
// candidates plus the batch folder.
function loadCheck(folder, arg) {
  let parsed;
  try { parsed = JSON.parse(readFileSync(arg, 'utf8')); }
  catch { throw new Error(`${arg}: unreadable`); }
  if (parsed && typeof parsed.savedAs === 'string' && parsed.savedAs.trim()) {
    const candidates = [parsed.savedAs, resolve(dirname(arg), '..', '..', parsed.savedAs), resolve(folder, parsed.savedAs)];
    const path = candidates.find((p) => existsSync(p));
    if (!path) throw new Error(`${arg}: pointer target ${parsed.savedAs} not found`);
    parsed = JSON.parse(readFileSync(path, 'utf8'));
  }
  const raw = parsed.response ?? parsed;
  if (!raw?.result || !Array.isArray(raw.result.commands)) throw new Error(`${arg}: not a command_check return`);
  return { raw, name: arg };
}

// Apply the hub-saved returns and the function contract. A command no return covered is
// not_checked — unchecked is not "not in the tree" — and carries no evidenceId. A command
// several returns disagree about is inconsistent and carries every side's violations and
// evidence. A return without result.build is build_unverified, not silently skipped.
export function applyCheck(folder, checkPaths, contractPath, build) {
  const wanted = collectBatch(folder);
  const loaded = checkPaths.map((arg) => loadCheck(folder, arg));
  const byCommand = new Map();
  const builds = new Set();
  const problems = [];
  for (const { raw, name } of loaded) {
    if (raw.result.build) builds.add(raw.result.build);
    else problems.push({ code: 'build_unverified', detail: `${name}: return has no result.build` });
    const evidenceId = raw?.evidence?.[0]?.evidenceId ?? null;
    for (const entry of raw.result.commands) {
      if (!byCommand.has(entry.command)) byCommand.set(entry.command, []);
      byCommand.get(entry.command).push({ status: entry.status, violations: Array.isArray(entry.violations) ? entry.violations : [], evidenceId });
    }
  }
  if (build) {
    if (builds.size && ![...builds].every((b) => b === build)) problems.push({ code: 'build_mismatch', detail: `check returns are for ${[...builds].join(', ')}, bound build is ${build}` });
    for (const item of readBatch(folder).cases) {
      if (item.build !== undefined && item.build !== build) problems.push({ code: 'build_mismatch', detail: `case ${item.autoid}: written for ${item.build}, bound build is ${build}` });
    }
  }
  const commands = wanted.commands.map(({ command, autoids }) => {
    const variants = byCommand.get(command);
    if (!variants?.length) return { command, autoids, status: 'not_checked', violations: [] };
    const statuses = [...new Set(variants.map((v) => v.status))];
    if (statuses.length === 1) {
      const evidenceId = variants.find((v) => v.evidenceId)?.evidenceId ?? null;
      return { command, autoids, status: statuses[0], violations: variants[0].violations, ...(evidenceId ? { evidenceId } : {}) };
    }
    const evidenceIds = [...new Set(variants.map((v) => v.evidenceId).filter(Boolean))];
    return { command, autoids, status: 'inconsistent', violations: variants.flatMap((v) => v.violations), evidenceIds };
  });
  let clients;
  if (contractPath) {
    const enabled = contractClients(contractPath);
    clients = wanted.clients.map(({ client, autoids }) => ({ client, autoids, status: enabled.has(client) ? 'enabled' : 'client_not_in_contract' }));
  } else {
    clients = wanted.clients.map(({ client, autoids }) => ({ client, autoids, status: 'client_not_checked' }));
  }
  const report = { schema: 'apv.case-review.commands', folder, build: build ?? null, problems, commands, clients };
  writeFileSync(join(folder, 'review_commands.json'), JSON.stringify(report, null, 2) + '\n');
  return report;
}

if (process.argv[1] && import.meta.url === `file://${process.argv[1]}`) {
  const [command, folder, ...rest] = process.argv.slice(2);
  if (command === 'collect' && folder) {
    console.log(JSON.stringify(collectBatch(folder), null, 2));
  } else if (command === 'apply' && folder) {
    const checks = [];
    let contract = null, build = null;
    for (let i = 0; i < rest.length; i++) {
      if (rest[i] === '--check') checks.push(rest[++i]);
      else if (rest[i] === '--contract') contract = rest[++i];
      else if (rest[i] === '--build') build = rest[++i];
    }
    if (!checks.length) { console.error('apply needs at least one --check <hub-saved return or pointer>'); process.exit(2); }
    if (!build) { console.error('apply needs --build <the bound build>'); process.exit(2); }
    const report = applyCheck(folder, checks, contract, build);
    console.log(JSON.stringify({ commands: report.commands.length, clients: report.clients.length, problems: report.problems.length }));
  } else {
    console.error('usage: node check.mjs collect <batch> | apply <batch> --build <id> --check <file>… [--contract <contract>]');
    process.exit(2);
  }
}
