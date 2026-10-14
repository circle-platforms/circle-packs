// Tool: 执行工作簿读取与形状校验(纯函数,输入字节、输出结构;不读环境、不连网、不写文件)。
// 治理判定不在此处:主机是否在床的闭集由 host-policy Hook 按已批准声明判,函数是否启用由
// workbook-contract Hook 按契约判;本 Tool 只查形状与字面量。
// 来源:server-s2 packs/apv/execution/workbook.ts @ bd364ac58ac16b8496c5bac39246b8c64c6e0e68
// 迁移说明:原版用 ExcelJS + fflate + server-s2 contracts 包;本版行为逐条保留,
// ApiError 换成同形 ModuleError,sha256/requireCondition/MAX_SOURCE_BYTES 内联为本地实现。
// imports(hub 依赖集): exceljs@4.4.0, fflate@0.8.3
import ExcelJS from 'exceljs';
import { unzipSync } from 'fflate';
import { ModuleError } from './mindmap.ts';
import { frameworkArguments, isHostToken } from './dialect.ts';
import type { FunctionContract } from './function-contract.ts';

export interface ExecutionStep { row: number; type: number; description: string; object: string; method: string; data: string; commands: string[]; saveAs?: string; inputRegister?: string; functionStatus?: string; call?: { command: string; kwargs: Record<string, string | number> } }
export interface ExecutionCase { autoid: string; steps: ExecutionStep[] }
export interface ExecutionBook {
  sha256: string; cases: ExecutionCase[]; initialization: ExecutionStep[];
  commands: { autoid: string | null; row: number; object: string; deviceIndex: number; command: string }[];
  hostCommands: { autoid: string | null; row: number; object: string; method: string; host: string; command: string; kwargs: Record<string, string | number> }[];
}
const headers = ['自动化ID', '优先级', '语句类型', '描述', '测试对象', '方法', '数据', '临时保存期望结果', '输入变量'];
const MAX_SOURCE_BYTES = 16 * 1024 * 1024;
const sha256Hex = async (bytes: Uint8Array): Promise<string> => {
  const digest = await globalThis.crypto.subtle.digest('SHA-256', bytes);
  return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, '0')).join('');
};

export async function readExecutionWorkbook(bytes: Buffer, functions?: FunctionContract): Promise<ExecutionBook> {
  let location: { row: number | null; autoid: string | null; object: string | null; method: string | null } = { row: null, autoid: null, object: null, method: null };
  const invalid = (message: string, details: Record<string, unknown> = {}) => new ModuleError('INVALID_EXECUTION_WORKBOOK', message, { ...location, ...details });
  try {
    if (!(bytes.length > 0 && bytes.length <= MAX_SOURCE_BYTES)) throw invalid('Execution workbook exceeds the input limit');
    let expanded = 0, entries = 0;
    unzipSync(bytes, {
      filter: (file) => {
        expanded += file.originalSize; entries++;
        if (entries > 256 || expanded > 64 * 1024 * 1024 || file.name.includes('..') || file.name.startsWith('/'))
          throw invalid('Workbook zip exceeds the safe contract bounds');
        return true;
      },
    });
    const workbook = new ExcelJS.Workbook(); await workbook.xlsx.load(bytes as any);
    if (workbook.worksheets.length !== 1 || workbook.worksheets[0].name !== '执行') throw invalid('Use the single execution sheet contract');
    const sheet = workbook.worksheets[0];
    if (sheet.getRow(1).hidden !== true || sheet.getCell('A1').value !== 'APV_EXCEL_CONTRACT | apv.excel.runtime | v1')
      throw invalid('The execution marker must be exact and row one hidden', { row: 1 });
    if (sheet.rowCount > 50000 || sheet.columnCount > 9) throw invalid('Workbook row or column bound exceeded');
    const literal = (row: number, col: number) => { const cell = sheet.getCell(row, col).value; return typeof cell === 'string' || typeof cell === 'number' ? String(cell) : null; };
    const value = (row: number, col: number) => {
      const cell = sheet.getCell(row, col).value;
      if (cell === null) return '';
      if (typeof cell !== 'string' && typeof cell !== 'number') throw invalid('Execution cells must be literal strings or numbers', { row, column: col });
      return String(cell);
    };
    let header = 0;
    for (let row = 2; row <= Math.min(sheet.rowCount, 100); row++)
      if (headers.every((text, index) => value(row, index + 1) === text)) { header = row; break; }
    if (!header) throw invalid('Execution columns are missing or reordered');
    const cases: ExecutionCase[] = [], initialization: ExecutionStep[] = [], commands: ExecutionBook['commands'] = [], hostCommands: ExecutionBook['hostCommands'] = [];
    let current: ExecutionCase | undefined, sentinel = false;
    for (let row = header + 1; row <= sheet.rowCount; row++) {
      location = { row, autoid: Number(literal(row, 3)) === 1 ? null : literal(row, 1) || current?.autoid || null, object: literal(row, 5) || null, method: literal(row, 6) || null };
      const cells = Array.from({ length: 9 }, (_, i) => value(row, i + 1));
      if (cells.every((v) => v === '')) continue;
      if (cells[0] === '999999999999999') { sentinel = true; current = undefined; continue; }
      if (sentinel) throw invalid('The sentinel must follow every executable case');
      const type = Number(cells[2]);
      if (cells[2] === '' || !Number.isInteger(type) || type < 0) throw invalid('Every execution row needs a numeric statement type');
      if (type === 1) location.autoid = null;
      if (type === 0) continue;
      if (type >= 2 && cells[0]) {
        if (!/^\d{1,32}$/.test(cells[0]) || cases.some((item) => item.autoid === cells[0])) throw invalid('Case identities must be unique numeric strings');
        current = { autoid: cells[0], steps: [] }; cases.push(current);
      }
      if (type >= 2 && !current) throw invalid('A step has no case identity');
      const step: ExecutionStep = { row, type, description: cells[3], object: cells[4], method: cells[5], data: cells[6], commands: [], ...(cells[7] ? { saveAs: cells[7] } : {}), ...(cells[8] ? { inputRegister: cells[8] } : {}) };
      // Function-contract status is data for the workbook-contract Hook; the parser never throws on it.
      if (functions && (step.object || step.method || step.data)) step.functionStatus = functions.status(step.object, step.method);
      const device = /^(?:APV_(\d+)|Seg(\d+)_tmp)$/.exec(step.object);
      if (device) {
        if (!['cmd', 'cmd_config', 'cmds_config', 'cmd_enable'].includes(step.method) || cells[8] !== '' || /\b(?:Reg|Seg)\d+_tmp\b|\$\{/.test(step.data))
          throw invalid('Device rows need literal command methods without runtime input substitution; expand fuzzy execute and disabled helpers first');
        step.call = frameworkArguments(step.method === 'cmd_config' ? step.data.replace(/[\r\n]/g, '') : step.data);
        step.commands = step.method === 'cmds_config' ? step.call.command.split(/\r?\n/).filter((command) => command.trim() !== '') : [step.call.command];
        if (!step.commands.length || step.commands.some((command) => !command.trim() || command.length > 2000 || /[\x00-\x08\x0b-\x1f]/.test(command)))
          throw invalid('Device command is empty or outside the contract bounds');
        for (const command of step.commands) commands.push({ autoid: type === 1 ? null : current!.autoid, row, object: step.object, deviceIndex: Number(device[1] ?? device[2]), command });
      } else if (step.object === 'test_env' || isHostToken(step.object)) {
        const host = step.object === 'test_env' ? step.method : step.object;
        if ((step.object !== 'test_env' && step.method !== 'cmd') || !step.data.trim() || step.data.length > 16384 || cells[8] !== '' || /[\x00-\x08\x0b-\x1f]/.test(step.data))
          throw invalid('Host dispatch needs a literal command method; input-register substitution is not supported');
        step.call = frameworkArguments(step.data);
        hostCommands.push({ autoid: type === 1 ? null : current!.autoid, row, object: step.object, method: step.method, host, command: step.call.command, kwargs: step.call.kwargs });
      } else if (step.object === 'check_point') {
        if (!['found', 'not_found', 'abs_found', 'found_times'].includes(step.method)) throw invalid('Checkpoint method is outside the supported execution contract');
      } else if (step.object === 'time' && step.method === 'sleep') {
        if (!Number.isFinite(Number(step.data)) || Number(step.data) < 0 || Number(step.data) > 3600) throw invalid('Sleep duration is outside the execution bounds');
      } else if (step.object || step.method || step.data) throw invalid('Opaque execution rows cannot prove every device command against the bound build');
      if (commands.length + hostCommands.length > 5000) throw invalid('Execution command count exceeds the bounded validation limit');
      if (type === 1) initialization.push(step); else current!.steps.push(step);
    }
    location = { row: null, autoid: null, object: null, method: null };
    if (!cases.length || (!commands.length && !hostCommands.length)) throw invalid('An execution workbook needs real cases and literal dispatch commands');
    const missing = cases.find((item) => !item.steps.some((step) => step.object === 'check_point'));
    if (missing) {
      const step = missing.steps[0];
      throw invalid('Every case needs an explicit checkpoint', { row: step?.row ?? null, autoid: missing.autoid, object: step?.object ?? null, method: step?.method ?? null });
    }
    return { sha256: await sha256Hex(bytes), cases, initialization, commands, hostCommands };
  } catch (error) {
    if (error instanceof ModuleError) {
      if (error.code === 'INVALID_EXECUTION_WORKBOOK') throw invalid(error.message, error.details);
      throw error;
    }
    throw invalid('Workbook could not be read as the execution contract');
  }
}

// The slim re-projection for an oversized book: hub retains the full projection as
// the step original and hands its bytes to the frame through the dynamic
// hub.result.<stepKey> slot. This export reads those retained bytes and returns the
// same shape minus the per-step description (the only field allowed to be big; the
// full projection stays in the original). It never re-reads the workbook.
export function projectWorkbookSlim(projectionBytes: Uint8Array) {
  let parsed: any;
  try { parsed = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(projectionBytes)); }
  catch { throw new ModuleError('INVALID_PAYLOAD', 'Workbook projection original is not valid UTF-8 JSON'); }
  if (typeof parsed?.sha256 !== 'string' || !Array.isArray(parsed?.cases) || !Array.isArray(parsed?.commands) || !Array.isArray(parsed?.hostCommands))
    throw new ModuleError('INVALID_PAYLOAD', 'Workbook projection original is not the projected book');
  return {
    sha256: parsed.sha256,
    cases: parsed.cases.map((item: any) => ({
      autoid: item.autoid,
      steps: (Array.isArray(item?.steps) ? item.steps : []).map((step: any) => {
        const slim = { ...step };
        delete slim.description;
        return slim;
      }),
    })),
    commands: parsed.commands,
    hostCommands: parsed.hostCommands,
  };
}
// The small projection the transition gates on: commands, host dispatches and case
// identities from the frozen workbook original. Byte-oriented so an oversized book
// never enters the frame; the optional contract original enables status annotation
// without blocking (the parser never enforces enablement — that is the Hook's job).
// The driver appends byteSlots to the argument tail in their declared order:
// byteSlots ['workbook', 'function-contract'] means (workbookBytes, contractBytes?).
// imports: exceljs@4.4.0 (already declared for this module)
export async function projectWorkbook(workbookBytes: Buffer, contractBytes?: Uint8Array) {
  const book = await readExecutionWorkbook(workbookBytes, contractBytes ? new (await import('./function-contract.ts')).FunctionContract(contractBytes) : undefined);
  return {
    sha256: book.sha256,
    cases: book.cases.map((item) => ({
      autoid: item.autoid,
      steps: item.steps.map((step) => ({
        row: step.row, description: step.description, object: step.object, method: step.method, data: step.data,
        functionStatus: step.functionStatus ?? null, commands: step.commands, ...(step.call ? { call: step.call } : {}),
      })),
    })),
    commands: book.commands.map((row) => ({ autoid: row.autoid, row: row.row, object: row.object, command: row.command })),
    hostCommands: book.hostCommands.map((row) => ({ autoid: row.autoid, row: row.row, object: row.object, method: row.method, host: row.host, command: row.command, kwargs: row.kwargs })),
  };
}
