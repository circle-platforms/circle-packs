// A tiny synthetic execution workbook in the A–I contract (documentation addresses),
// for the hub-convention Tool invocation test. Marker, identity row and one case.
import ExcelJS from 'exceljs';
export async function syntheticWorkbook() {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet('执行');
  ws.getCell('A1').value = 'APV_EXCEL_CONTRACT | apv.excel.runtime | v1';
  ws.getRow(1).hidden = true;
  ws.addRow([]);
  ws.addRow(['自动化ID', '优先级', '语句类型', '描述', '测试对象', '方法', '数据', '临时保存期望结果', '输入变量']);
  ws.addRow([null, null, 0, 'Author: synthetic']);
  ws.addRow(['301', 'P1', 2, 'cfg', 'APV_0', 'cmd_config', 'service alpha', null, null]);
  ws.addRow([null, null, 3, 'cp', 'check_point', 'found', 'ok', null, null]);
  return Buffer.from(await wb.xlsx.writeBuffer());
}
