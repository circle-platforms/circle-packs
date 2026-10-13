// Tool: Excel 函数契约解析与查询(纯函数,输入字节、输出结构;不读环境、不连网、不写文件)。
// 来源:server-s2 packs/apv/execution/function-contract.ts @ bd364ac58ac16b8496c5bac39246b8c64c6e0e68
// 迁移说明:原版用 zod 校验并报 ApiError;本版内联校验,错误用本模块的 ModuleError,
// 行为不变:schema 必须为 ist.excel.function-contract 且 complete,条目去重,状态查询照旧。
import { ModuleError } from './mindmap.ts';

type Status = 'enabled' | 'disabled' | 'internal';
const STATUSES = new Set<Status>(['enabled', 'disabled', 'internal']);

export class FunctionContract {
  methods = new Map<string, Status>();
  objects = new Map<string, Status>();
  constructor(bytes: Uint8Array) {
    let parsed: any;
    try { parsed = JSON.parse(new TextDecoder('utf-8').decode(bytes)); }
    catch { throw new ModuleError('INVALID_PAYLOAD', 'Function contract must be complete JSON with e/f/status entries', { field: 'function-contract' }); }
    if (parsed?.schema !== 'ist.excel.function-contract' || parsed?.complete !== true || !Array.isArray(parsed.entries) || !parsed.entries.length || parsed.entries.length > 10000)
      throw new ModuleError('INVALID_PAYLOAD', 'Function contract must be complete JSON with e/f/status entries', { field: 'function-contract' });
    for (const entry of parsed.entries) {
      if (!entry || typeof entry.e !== 'string' || !entry.e || entry.e.length > 200 || typeof entry.f !== 'string' || !entry.f || entry.f.length > 200 || !STATUSES.has(entry.status))
        throw new ModuleError('INVALID_PAYLOAD', 'Function contract entry is malformed', { field: 'function-contract' });
      const key = JSON.stringify([entry.e, entry.f]);
      if (this.methods.has(key))
        throw new ModuleError('INVALID_PAYLOAD', 'Function contract contains duplicate method declarations', { field: 'function-contract', object: entry.e, method: entry.f });
      this.methods.set(key, entry.status);
    }
    for (const entry of parsed.objects ?? []) {
      if (!entry || typeof entry.e !== 'string' || !entry.e || entry.e.length > 200 || !STATUSES.has(entry.status))
        throw new ModuleError('INVALID_PAYLOAD', 'Function contract object is malformed', { field: 'function-contract' });
      if (this.objects.has(entry.e))
        throw new ModuleError('INVALID_PAYLOAD', 'Function contract contains duplicate object declarations', { field: 'function-contract', object: entry.e });
      this.objects.set(entry.e, entry.status);
    }
  }
  status(object: string, method: string): Status | 'absent' {
    const status = this.objects.get(object);
    return status && status !== 'enabled' ? status : this.methods.get(JSON.stringify([object, method])) ?? 'absent';
  }
}
