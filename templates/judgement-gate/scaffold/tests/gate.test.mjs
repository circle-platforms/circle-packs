import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { emitGated } from '../scripts/emit.mjs';
import { gateContract } from '../scripts/gate.mjs';

function fixture() {
  const folder = mkdtempSync(join(tmpdir(), 'scaffold-'));
  const text = 'alpha beta\n';
  const saved = join(folder, 'return.json');
  writeFileSync(saved, JSON.stringify({
    response: { result: { path: 'sources/note.txt', contentBase64: Buffer.from(text).toString('base64') }, evidence: [{ evidenceId: 'evd_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa' }] },
  }));
  return { folder, saved };
}

test('the gate keeps a verbatim quote and emit copies the saved evidence id', () => {
  const { folder, saved } = fixture();
  const contract = join(folder, 'contract.json');
  writeFileSync(contract, `${JSON.stringify({
    schema: 'circle-packs/judgement-contract/1',
    origin: 'model',
    items: [{ id: 'i1', quote: 'alpha beta', source: { savedAs: 'return.json' } }],
  }, null, 2)}\n`);
  const gate = gateContract(folder, contract);
  assert.equal(gate.items[0].evidenceId, 'evd_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa');
  const emitted = emitGated(folder, contract);
  assert.equal(emitted.items[0].origin, 'script');
  assert.equal(emitted.items[0].quote, 'alpha beta');
});

test('a transcribed return and a quote that is not in the original are refused', () => {
  const { folder } = fixture();
  const contract = join(folder, 'contract.json');
  writeFileSync(contract, JSON.stringify({
    schema: 'circle-packs/judgement-contract/1',
    origin: 'model',
    items: [{ id: 'i1', quote: 'alpha', source: { savedAs: 'x', result: { text: 'alpha' } } }],
  }));
  assert.throws(() => gateContract(folder, contract), /pointer_not_transcribe/);
  writeFileSync(contract, JSON.stringify({
    schema: 'circle-packs/judgement-contract/1',
    origin: 'model',
    items: [{ id: 'i1', quote: 'not in the file', source: { savedAs: 'return.json' } }],
  }));
  assert.throws(() => gateContract(folder, contract), /quote_not_verbatim/);
});

test('a local file is read, and a line the contract skips is refused', () => {
  const folder = mkdtempSync(join(tmpdir(), 'scaffold-local-'));
  writeFileSync(join(folder, 'note.txt'), '第一条 已覆盖\n第二条 未覆盖\n');
  const contract = join(folder, 'contract.json');
  const body = (quotes) => JSON.stringify({
    schema: 'circle-packs/judgement-contract/1',
    origin: 'model',
    items: quotes.map((quote, index) => ({ id: `i${index + 1}`, quote, source: { savedAs: 'note.txt' } })),
  });
  writeFileSync(contract, body(['第一条 已覆盖']));
  assert.throws(() => gateContract(folder, contract), /input_not_covered/);
  writeFileSync(contract, body(['第一条 已覆盖', '第二条 未覆盖']));
  const gate = gateContract(folder, contract);
  assert.equal(gate.ok, true);
  assert.equal(gate.items[0].evidenceId, null);
});

test('emit refuses a contract edited after the gate', () => {
  const { folder, saved } = fixture();
  const contract = join(folder, 'contract.json');
  writeFileSync(contract, JSON.stringify({
    schema: 'circle-packs/judgement-contract/1',
    origin: 'model',
    items: [{ id: 'i1', quote: 'alpha beta', source: { savedAs: 'return.json' } }],
  }));
  gateContract(folder, contract);
  writeFileSync(contract, JSON.stringify({
    schema: 'circle-packs/judgement-contract/1',
    origin: 'model',
    items: [{ id: 'i1', quote: 'alpha', source: { savedAs: saved } }],
  }));
  assert.throws(() => emitGated(folder, contract), /contract_changed_after_gate/);
});
