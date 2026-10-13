#!/usr/bin/env node
// Step 2: deterministic command and contract checks.
//   node check.mjs collect <batch>            print the deduped device commands (with their
//                                             source autoids) and the client names, to pass
//                                             verbatim to srv_buildsite_command_check
//   node check.mjs apply <batch> --check <hub-saved command_check return> --contract <Excel
//                                             function contract>   write out/review_commands.json
// The model never transcribes a server response: apply loads the hub-saved file itself,
// re-derives the per-command verdicts and takes the evidenceId from it.
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { readBatch, checkStructure } from './prep.mjs';

// The enabled test_env clients of the execution side's Excel function contract.
export function contractClients(contractPath) {
  const contract = JSON.parse(readFileSync(contractPath, 'utf8'));
  if (contract?.schema !== 'ist.excel.function-contract' || !Array.isArray(contract.entries))
    throw new Error(`${contractPath}: not an Excel function contract`);
  return new Set(contract.entries.filter((entry) => entry.e === 'test_env' && entry.status === 'enabled').map((entry) => entry.f));
}

// What the batch asks for: deduped device commands (each with the autoids that use it) and
// the client names, in first-seen order.
export function collectBatch(folder) {
  const commands = new Map();
  const clients = new Map();
  for (const item of readBatch(folder)) {
    const { deviceCommands, clients: caseClients } = checkStructure(item);
    for (const command of [...(Array.isArray(item.init_commands) ? item.init_commands : []), ...deviceCommands]) {
      if (typeof command !== 'string' || !command.trim()) continue;
      if (!commands.has(command)) commands.set(command, []);
      commands.get(command).push(item.autoid);
    }
    for (const client of caseClients) {
      if (!clients.has(client)) clients.set(client, []);
      clients.get(client).push(item.autoid);
    }
  }
  return {
    commands: [...commands.entries()].map(([command, autoids]) => ({ command, autoids })),
    clients: [...clients.entries()].map(([client, autoids]) => ({ client, autoids })),
  };
}

// Apply the hub-saved command_check return and the function contract. The saved file is the
// shape the hub writes: {tool, args, at, response: {result, evidence}} (older: {result}).
export function applyCheck(folder, checkPath, contractPath) {
  const wanted = collectBatch(folder);
  const saved = JSON.parse(readFileSync(checkPath, 'utf8'));
  const raw = saved.response ?? saved;
  const result = raw?.result;
  if (!result || !Array.isArray(result.commands)) throw new Error(`${checkPath}: not a command_check return`);
  const evidenceId = raw?.evidence?.[0]?.evidenceId ?? null;
  const byCommand = new Map(result.commands.map((entry) => [entry.command, entry]));
  const commands = wanted.commands.map(({ command, autoids }) => {
    const entry = byCommand.get(command);
    return {
      command,
      autoids,
      status: entry ? entry.status : 'missing',
      violations: entry?.violations ?? [{ code: 'NOT_CHECKED' }],
      ...(evidenceId ? { evidenceId } : {}),
    };
  });
  const uncovered = wanted.commands.filter(({ command }) => !byCommand.has(command));
  const clients = contractPath
    ? wanted.clients.map(({ client, autoids }) => ({ client, autoids, status: contractClients(contractPath).has(client) ? 'enabled' : 'not_in_contract' }))
    : wanted.clients.map(({ client, autoids }) => ({ client, autoids, status: 'not_checked' }));
  const report = { schema: 'apv.case-review.commands', folder, build: result.build ?? null, commands, clients, uncovered: uncovered.map((c) => c.command) };
  writeFileSync(join(folder, 'review_commands.json'), JSON.stringify(report, null, 2) + '\n');
  return report;
}

if (process.argv[1] && import.meta.url === `file://${process.argv[1]}`) {
  const [command, folder, ...rest] = process.argv.slice(2);
  if (command === 'collect' && folder) {
    console.log(JSON.stringify(collectBatch(folder), null, 2));
  } else if (command === 'apply' && folder) {
    const at = rest.indexOf('--check');
    const ct = rest.indexOf('--contract');
    const check = at >= 0 ? rest[at + 1] : null;
    const contract = ct >= 0 ? rest[ct + 1] : null;
    if (!check || !existsSync(check)) { console.error('apply needs --check <hub-saved command_check return>'); process.exit(2); }
    const report = applyCheck(folder, check, contract);
    console.log(JSON.stringify({ commands: report.commands.length, clients: report.clients.length, uncovered: report.uncovered.length }));
  } else {
    console.error('usage: node check.mjs collect <batch> | apply <batch> --check <file> [--contract <contract>]');
    process.exit(2);
  }
}
