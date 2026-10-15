// Tool: 受控历史回读(纯函数,输入字节、输出结构;不读环境、不连网、不写文件)。
// hub 在 transition 帧超预算时(historyMode:"controlled")把窗口外的观察归档为
// 受控槽 hub.history.observations.<sha>,字节为 canonicalJson({schema:'hub-flow-history/1',
// observations:[…]})。pickObservations 按 stepId 取最新 occurrence 的观察,只保留
// transition 真正读的字段并剥掉大字符串,保证单个结果落在 256 KiB 内。
// imports(hub 依赖集): 无
export interface PickedObservation {
  facts: Record<string, unknown>;
  operationId?: string | null;
}

const HISTORY_SCHEMA = 'hub-flow-history/1';
const MAX_RESULT_BYTES = 256 * 1024;

class HistoryError extends Error {
  readonly code: string;
  constructor(code: string, message: string) { super(message); this.code = code; }
}
const fail = (code: string, message: string): never => { throw new HistoryError(code, message); };

const byteLength = (value: unknown) => new TextEncoder().encode(JSON.stringify(value ?? null)).length;

// 字段预算:workbook 瘦投影(命令/主机命令行,不带 description 大字符串),tree 只带
// heads,submit/parse-results 保留判定要用的键,其余观察保留小键原样。
const WORKBOOK_ROW_KEYS = ['autoid', 'row', 'command', 'object', 'host', 'method', 'kwargs', 'functionStatus'];
const KEEP_KEYS: Record<string, string[]> = {
  submit: ['stepId', 'status', 'occurrence', 'result', 'error'],
  'parse-results': ['stepId', 'status', 'occurrence', 'result', 'error'],
  environment: ['stepId', 'status', 'occurrence', 'result'],
  topology: ['stepId', 'status', 'occurrence', 'result'],
  'device-map': ['stepId', 'status', 'occurrence', 'result'],
  tree: ['stepId', 'status', 'occurrence', 'result'],
  workbook: ['stepId', 'status', 'occurrence', 'result'],
  'workbook-slim': ['stepId', 'status', 'occurrence', 'result'],
};
// 大字符串防御:任何超长字符串值折叠成指针标记,不让单个字段撑爆预算。
const foldStrings = (value: any, depth = 0): any => {
  if (typeof value === 'string') return value.length > 4096 ? { folded: true, length: value.length } : value;
  if (Array.isArray(value)) return depth >= 16 ? [] : value.map((item) => foldStrings(item, depth + 1));
  if (value && typeof value === 'object') {
    if (depth >= 16) return {};
    const out: Record<string, unknown> = {};
    for (const key of Object.keys(value)) out[key] = foldStrings(value[key], depth + 1);
    return out;
  }
  return value;
};

const slimWorkbook = (result: any) => {
  if (!result || typeof result !== 'object') return result;
  const commands = Array.isArray(result.commands) ? result.commands.map((row: any) =>
    Object.fromEntries(WORKBOOK_ROW_KEYS.filter((key) => row?.[key] !== undefined).map((key) => [key, row[key]]))) : undefined;
  const hostCommands = Array.isArray(result.hostCommands) ? result.hostCommands.map((row: any) =>
    Object.fromEntries(WORKBOOK_ROW_KEYS.filter((key) => row?.[key] !== undefined).map((key) => [key, row[key]]))) : undefined;
  return foldStrings({ ...(commands ? { commands } : {}), ...(hostCommands ? { hostCommands } : {}) });
};

const slimResult = (stepId: string, result: any) => {
  if (stepId === 'workbook' || stepId === 'workbook-slim') return slimWorkbook(result);
  if (stepId === 'tree') {
    // 只带 heads(核对投影),不带逐命令明细
    return foldStrings({ ...(Array.isArray(result?.heads) ? { heads: result.heads } : {}), ...(result?.result?.sourceSha256 ? { result: { sourceSha256: result.result.sourceSha256 } } : {}) });
  }
  return foldStrings(result);
};

const slimFacts = (stepId: string, facts: any) => {
  const keep = KEEP_KEYS[stepId];
  if (!keep) return foldStrings(facts);
  const out: Record<string, unknown> = {};
  for (const key of keep) if (facts?.[key] !== undefined) out[key] = key === 'result' ? slimResult(stepId, facts[key]) : facts[key];
  return out;
};

export function pickObservations(stepIds: string[], historyBytes: Uint8Array): { observations: Record<string, any> } {
  if (!(historyBytes instanceof Uint8Array)) fail('INVALID_PAYLOAD', 'history original bytes are required');
  if (!Array.isArray(stepIds) || stepIds.some((id) => typeof id !== 'string')) fail('INVALID_PAYLOAD', 'stepIds must be a list of strings');
  let parsed: any;
  try { parsed = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(historyBytes)); }
  catch { fail('INVALID_PAYLOAD', 'history original is not valid UTF-8 JSON'); }
  if (parsed?.schema !== HISTORY_SCHEMA || !Array.isArray(parsed.observations))
    fail('INVALID_PAYLOAD', `history original must be ${HISTORY_SCHEMA}`);
  const wanted = new Set(stepIds);
  const latest = new Map<string, any>();
  for (const row of parsed.observations) {
    const stepId = row?.facts?.stepId ?? row?.stepId;
    if (typeof stepId !== 'string' || !wanted.has(stepId)) continue;
    const occurrence = Number(row?.facts?.occurrence ?? 0);
    const known = latest.get(stepId);
    if (!known || occurrence >= known.occurrence) latest.set(stepId, { occurrence, row });
  }
  const observations: Record<string, any> = {};
  for (const [stepId, { row }] of latest) {
    const facts = row?.facts ?? row;
    observations[stepId] = { facts: slimFacts(stepId, facts), ...(row?.operationId !== undefined ? { operationId: row.operationId ?? null } : {}) };
    if (byteLength(observations) > MAX_RESULT_BYTES) fail('RESULT_TOO_LARGE', `history projection for ${stepId} exceeds the budget`);
  }
  return { observations };
}
