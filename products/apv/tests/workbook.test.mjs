import { test } from 'node:test';
import assert from 'node:assert/strict';
import ExcelJS from 'exceljs';
import { readExecutionWorkbook } from '../tools/workbook.ts';
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
    ['100000000000000002', 'P1', 2, 'dig', 'test_env', 'routera', 'dig @172.16.34.70 autotest.com', null, null],
    [null, null, 3, 'check', 'check_point', 'found', 'NOERROR', null, null],
    ['999999999999999', 'P9', 2, 'sentinel', 'time', 'sleep', '1', null, null],
  ]);
  const book = await readExecutionWorkbook(bytes, new FunctionContract(enc(CONTRACT)));
  assert.equal(book.cases.length, 2);
  assert.equal(book.commands.length, 1);
  assert.equal(book.commands[0].command, 'sdns on');
  assert.equal(book.hostCommands.length, 1);
  assert.equal(book.hostCommands[0].host, 'routera');
  assert.equal(book.hostCommands[0].command, 'dig @172.16.34.70 autotest.com');
});

test('rejects when the function contract disables a method', async () => {
  const bytes = await makeBook([
    ['100000000000000001', 'P1', 2, 'cfg', 'APV_0', 'reboot', '', null, null],
    [null, null, 3, 'check', 'check_point', 'found', 'x', null, null],
  ]);
  await assert.rejects(() => readExecutionWorkbook(bytes, new FunctionContract(enc(CONTRACT))), /not enabled/);
});

test('rejects a workbook without the hidden marker row', async () => {
  const bytes = await makeBook([['1', 'P1', 2, 'x', 'APV_0', 'cmd_config', 'sdns on', null, null]], { hidden: false });
  await assert.rejects(() => readExecutionWorkbook(bytes), /marker/);
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
