import { test } from 'node:test';
import assert from 'node:assert/strict';
import ExcelJS from 'exceljs';
import { readExecutionWorkbook, projectWorkbook, projectWorkbookSlim } from '../tools/workbook.ts';
import { FunctionContract } from '../tools/function-contract.ts';

const HEADERS = ['自动化ID', '优先级', '语句类型', '描述', '测试对象', '方法', '数据', '临时保存期望结果', '输入变量'];
const MARKER = 'APV_EXCEL_CONTRACT | apv.excel.runtime | v1';

async function makeBook(rows, { hidden = true, marker = MARKER } = {}) {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet('执行');
  ws.getCell('A1').value = marker;
  ws.getRow(1).hidden = hidden;
  ws.addRow([]); // row 2
  ws.addRow(HEADERS); // row 3
  for (const row of rows) ws.addRow(row);
  return Buffer.from(await wb.xlsx.writeBuffer());
}

const enc = (s) => new TextEncoder().encode(s);
const CONTRACT = JSON.stringify({
  schema: 'ist.excel.function-contract',
  complete: true,
  entries: [
    { e: 'APV_0', f: 'cmd_config', status: 'enabled' },
    { e: 'APV_0', f: 'cmds_config', status: 'enabled' },
    { e: 'test_env', f: 'routera', status: 'enabled' },
    { e: 'check_point', f: 'found', status: 'enabled' },
    { e: 'time', f: 'sleep', status: 'enabled' },
  ],
});

test('reads a sound workbook: cases, device commands, host commands, checkpoint', async () => {
  const bytes = await makeBook([
    ['100000000000000001', 'P1', 2, 'cfg', 'APV_0', 'cmd_config', 'sdns on', null, null],
    [null, null, 3, 'check', 'check_point', 'found', 'sdns', null, null],
    ['100000000000000002', 'P1', 2, 'dig', 'test_env', 'routera', 'dig @192.0.2.70 autotest.com', null, null],
    [null, null, 3, 'check', 'check_point', 'found', 'NOERROR', null, null],
    ['999999999999999', 'P9', 2, 'sentinel', 'time', 'sleep', '1', null, null],
  ]);
  const book = await readExecutionWorkbook(bytes, new FunctionContract(enc(CONTRACT)));
  assert.equal(book.cases.length, 2);
  assert.equal(book.commands.length, 1);
  assert.equal(book.commands[0].command, 'sdns on');
  assert.equal(book.hostCommands.length, 1);
  assert.equal(book.hostCommands[0].host, 'routera');
  assert.equal(book.hostCommands[0].command, 'dig @192.0.2.70 autotest.com');
});

test('a disabled function annotates functionStatus instead of throwing; the Hook decides', async () => {
  const bytes = await makeBook([
    ['100000000000000001', 'P1', 2, 'dig', 'routera', 'cmd', 'dig @192.0.2.70 x', null, null],
    [null, null, 3, 'check', 'check_point', 'found', 'NOERROR', null, null],
  ]);
  const disabled = JSON.stringify({ schema: 'ist.excel.function-contract', complete: true, entries: [{ e: 'routera', f: 'cmd', status: 'disabled' }] });
  const book = await readExecutionWorkbook(bytes, new FunctionContract(enc(disabled)));
  assert.equal(book.cases[0].steps[0].functionStatus, 'disabled'); // parser records, never rejects
  const workbookContract = (await import('../hooks/workbook-contract.ts')).default;
  const verdict = workbookContract({ event: 'verify.workbook', binding: {}, subject: { client: 'routera', contract: { testEnvEnabled: ['otherhost'] } } });
  assert.equal(verdict.code, 'COMMAND_VALIDATION_FAILED'); // the Hook decides enablement
});

test('an unknown host parses; the host-policy Hook blocks it against the declaration', async () => {
  const bytes = await makeBook([
    ['100000000000000001', 'P1', 2, 'dig', 'some-unknown-host', 'cmd', 'dig @192.0.2.70 x', null, null],
    [null, null, 3, 'check', 'check_point', 'found', 'NOERROR', null, null],
  ]);
  const book = await readExecutionWorkbook(bytes);
  const host = book.hostCommands[0];
  assert.equal(host.host, 'some-unknown-host'); // shape-only parser lets it through
  // the governance decision is the Hook's, against the approved declaration:
  const policy = (await import('../hooks/host-policy.ts')).default;
  const verdict = policy({ event: 'verify.hostCommand', binding: { resource: { declaration: { allowedTestHosts: ['routera'], hostCommandPolicies: {} } } }, subject: { command: host.command, host: host.host, method: 'cmd', kwargs: {} } });
  assert.equal(verdict.code, 'HOST_NOT_IN_BED');
});

test('rejects a workbook without the hidden marker row', async () => {
  const bytes = await makeBook([['1', 'P1', 2, 'x', 'APV_0', 'cmd_config', 'sdns on', null, null]], { hidden: false });
  await assert.rejects(() => readExecutionWorkbook(bytes), /marker/);
});

test('projectWorkbook keeps description, commands and call on every step', async () => {
  const bytes = await makeBook([
    ['100000000000000001', 'P1', 2, 'device cfg', 'APV_0', 'cmd_config', 'sdns on', null, null],
    [null, null, 2, 'host dig', 'test_env', 'routera', 'dig @192.0.2.70 autotest.com', null, null],
    [null, null, 3, 'check', 'check_point', 'found', 'sdns', null, null],
  ]);
  const projection = await projectWorkbook(bytes, enc(CONTRACT));
  const steps = projection.cases[0].steps;
  assert.equal(steps[0].description, 'device cfg');
  assert.deepEqual(steps[0].commands, ['sdns on']);
  assert.equal(steps[0].call.command, 'sdns on');
  assert.equal(steps[1].description, 'host dig');
  assert.equal(steps[1].call.command, 'dig @192.0.2.70 autotest.com');
  assert.equal(steps[1].functionStatus, 'enabled');
  assert.equal(projection.hostCommands[0].functionStatus, 'enabled'); // the host row's contract annotation, for testEnvEnabled
});

test('projectWorkbookSlim drops descriptions and keeps the gating fields', async () => {
  const bytes = await makeBook([
    ['100000000000000001', 'P1', 2, 'device cfg', 'APV_0', 'cmd_config', 'sdns on', null, null],
    [null, null, 3, 'check', 'check_point', 'found', 'sdns', null, null],
  ]);
  const full = await projectWorkbook(bytes, enc(CONTRACT));
  const slim = projectWorkbookSlim(enc(JSON.stringify(full)));
  assert.equal(slim.sha256, full.sha256);
  assert.deepEqual(slim.commands, full.commands);
  assert.equal(slim.cases[0].steps[0].description, undefined);
  assert.deepEqual(slim.cases[0].steps[0].commands, ['sdns on']);
  assert.throws(() => projectWorkbookSlim(enc('{oops')), /not valid UTF-8 JSON/);
  assert.throws(() => projectWorkbookSlim(enc('{"foo":1}')), /not the projected book/);
});

test('rejects a case without a checkpoint', async () => {
  const bytes = await makeBook([
    ['100000000000000001', 'P1', 2, 'cfg', 'APV_0', 'cmd_config', 'sdns on', null, null],
    ['999999999999999', 'P9', 2, 'sentinel', 'time', 'sleep', '1', null, null],
  ]);
  await assert.rejects(() => readExecutionWorkbook(bytes, new FunctionContract(enc(CONTRACT))), /checkpoint/);
});

test('rejects rows after the sentinel', async () => {
  const bytes = await makeBook([
    ['999999999999999', 'P9', 2, 'sentinel', 'time', 'sleep', '1', null, null],
    ['100000000000000001', 'P1', 2, 'cfg', 'APV_0', 'cmd_config', 'sdns on', null, null],
  ]);
  await assert.rejects(() => readExecutionWorkbook(bytes), /sentinel/);
});
