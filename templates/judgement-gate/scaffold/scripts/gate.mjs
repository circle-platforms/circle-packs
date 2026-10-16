#!/usr/bin/env node
// Gate: schema, pointer-not-transcribe, verbatim quote, evidence taken from the saved return,
// and a check that every input item is covered by the contract.
import { readFileSync, writeFileSync } from 'node:fs';
import { assertCovered, assertExactKeys, assertOriginModel, assertTextCovered, assertVerbatim, inputIds, loadOriginal, readJson, sha256 } from './pointers.mjs';

const ITEM_KEYS = ['id', 'quote', 'source'];

export function gateContract(folder, contractPath) {
  const bytes = readFileSync(contractPath);
  const contract = readJson(contractPath);
  assertExactKeys(contract, ['items', 'origin', 'schema'], 'contract');
  assertOriginModel(contract, 'contract');
  if (contract.schema !== 'circle-packs/judgement-contract/1') throw new Error('schema_invalid: schema');
  if (!Array.isArray(contract.items) || !contract.items.length) throw new Error('schema_invalid: items');
  const groups = new Map();
  const items = contract.items.map((item, index) => {
    assertExactKeys(item, ITEM_KEYS, `item ${index}`);
    if (typeof item.id !== 'string' || !/^[a-z0-9-]{1,40}$/.test(item.id)) throw new Error(`schema_invalid: item ${index} id`);
    const saved = loadOriginal(folder, item.source, `item ${index} source`);
    assertVerbatim(item.quote, saved.text, item.id);
    const bucket = groups.get(saved.savedAs) ?? { text: saved.text, ids: [], quotes: [] };
    bucket.ids.push(item.id);
    bucket.quotes.push(item.quote);
    groups.set(saved.savedAs, bucket);
    return { id: item.id, quote: item.quote, evidenceId: saved.evidenceId, savedAs: saved.savedAs };
  });
  for (const [savedAs, bucket] of groups) {
    const ids = inputIds(bucket.text);
    if (ids) assertCovered(ids, bucket.ids, savedAs);
    else assertTextCovered(bucket.text, bucket.quotes, savedAs);
  }
  const gate = { ok: true, origin: 'script', contractSha256: sha256(bytes), items };
  writeFileSync(`${folder}/gate.json`, `${JSON.stringify(gate, null, 2)}\n`);
  return gate;
}

if (process.argv[1] && import.meta.url === `file://${process.argv[1]}`) {
  const [folder, ...rest] = process.argv.slice(2);
  let contract;
  for (let i = 0; i < rest.length; i++) if (rest[i] === '--contract') contract = rest[++i];
  if (!folder || !contract) {
    console.error('usage: node gate.mjs <folder> --contract <file>');
    process.exit(2);
  }
  gateContract(folder, contract);
}
