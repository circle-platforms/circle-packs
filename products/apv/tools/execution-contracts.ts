// Tool: 执行流输入输出结构与流程版本(纯数据 + 校验函数)。
// 对齐 hub-execution-transition/1 的附录 A2:输入 {schema, binding, currentInput,
// state, observations, controlledBytes},输出 {schema, state, actions};预算(256 KiB
// state、32 KiB 普通字符串、数组 256、深度 16、受控原件合计 8 MiB)在 transition
// 出口统一核验。不注册驱动器、不改 hub phase;只定义与校验数据。
// imports(hub 依赖集): 无

export const TRANSITION_SCHEMA = 'hub-execution-transition/1';
export const FLOW_VERSION = 'apv-case-execute/2';

// The action kinds the APV transition may emit; the driver validates the rest.
export const ACTION_KINDS = ['tool.call', 'provider.call', 'operation.wait', 'hook.verify', 'outcome.error', 'delivery.propose'] as const;
export type ActionKind = (typeof ACTION_KINDS)[number];

export const HOOK_EVENTS = ['verify.deviceCommand', 'verify.hostCommand', 'verify.workbook', 'beforeDispatch', 'afterResult'] as const;
export type HookEvent = (typeof HOOK_EVENTS)[number];

export const DELIVERY_STATUSES = ['succeeded', 'partial'] as const;
// Registered hub error codes this flow may emit (packages/contracts/src/index.ts);
// product judgment codes that are not registered here must not appear in outcomes.
// INVALID_PAYLOAD is the passthrough for a Tool-stage input failure (for example the
// function-contract original not parsing); it is hub-registered, not a product code.
export const OUTCOME_CODES = ['BUILD_MISMATCH', 'GATEWAY_REFUSED', 'LEASE_UNAVAILABLE', 'INVALID_EXECUTION_WORKBOOK', 'COMMAND_VALIDATION_FAILED', 'COMMAND_NOT_IN_TREE', 'HOOK_FAILED', 'EVIDENCE_INSUFFICIENT', 'INVALID_PAYLOAD', 'SOURCE_UNREACHABLE', 'UPSTREAM_TIMEOUT', 'SOURCE_HASH_MISMATCH'] as const;
export type OutcomeCode = (typeof OUTCOME_CODES)[number];

// The provider protocol tools this flow drives — the names the resource's
// receiptPolicy declares (case-gateway.json's configuration): the worker drives the
// lease trio, submit/status/results and reconcile (case_status); the transition
// itself only issues the read-only env_prepare and bed_topology observations.
export const PROVIDER_TOOLS = {
  submitTool: 'case_submit',
  statusTool: 'case_status',
  resultTool: 'case_results',
  reconcileTool: 'case_status',
  prepareTool: 'env_prepare',
  topologyTool: 'bed_topology',
  taskIdArgument: 'task_id',
} as const;

// A2 budgets, checked at the transition's exit as one deterministic pass.
export const BUDGETS = {
  stateBytes: 256 * 1024,
  stringBytes: 32 * 1024,
  arrayItems: 256,
  depth: 16,
  controlledBytes: 8 * 1024 * 1024,
} as const;

const textEncoder = new TextEncoder();
const byteLength = (text: string) => textEncoder.encode(text).length;

// Finite-JSON guard: rejects NaN/Infinity, undefined, BigInt, functions, symbols,
// sparse arrays, class instances (Date/Map/Set) and cycles — the values A2 excludes.
export function finiteJsonOk(value: unknown, seen = new Set<unknown>()): boolean {
  if (value === null) return true;
  const type = typeof value;
  if (type === 'string' || type === 'boolean') return true;
  if (type === 'number') return Number.isFinite(value);
  if (type !== 'object') return false;
  const proto = Object.getPrototypeOf(value);
  if (proto !== Object.prototype && proto !== Array.prototype) return false;
  if (seen.has(value)) return false; // a cycle on the current path
  seen.add(value);
  const ok = Array.isArray(value)
    ? Object.keys(value).length === value.length && value.every((item) => finiteJsonOk(item, seen))
    : Object.values(value).every((item) => finiteJsonOk(item, seen));
  seen.delete(value); // shared references on different paths are legitimate JSON
  return ok;
}

function budgetOk(value: unknown, depth: number, problems: string[]): boolean {
  if (typeof value === 'string') {
    if (byteLength(value) > BUDGETS.stringBytes) problems.push(`string over ${BUDGETS.stringBytes} bytes`);
    return true;
  }
  if (value === null || typeof value !== 'object') return true;
  if (depth > BUDGETS.depth) problems.push(`depth over ${BUDGETS.depth}`);
  if (Array.isArray(value)) {
    if (value.length > BUDGETS.arrayItems) problems.push(`array over ${BUDGETS.arrayItems} items`);
    return value.every((item) => budgetOk(item, depth + 1, problems));
  }
  return Object.entries(value).every(([key, item]) => {
    if (byteLength(key) > BUDGETS.stringBytes) problems.push(`key over ${BUDGETS.stringBytes} bytes`);
    return budgetOk(item, depth + 1, problems);
  });
}

// Validates a transition output against the A2 shape and budgets. Returns [] when
// the output may pass to the driver; each problem is a refusal reason.
export function validateTransitionOutput(output: any): string[] {
  const problems: string[] = [];
  if (!output || typeof output !== 'object') return ['output is not an object'];
  if (output.schema !== TRANSITION_SCHEMA) problems.push(`schema must be ${TRANSITION_SCHEMA}`);
  if (!output.state || typeof output.state !== 'object') problems.push('state is required');
  if (!Array.isArray(output.actions)) problems.push('actions must be an array');
  if (output.actions?.length > BUDGETS.arrayItems) problems.push(`actions over ${BUDGETS.arrayItems}`);
  if (!finiteJsonOk(output)) problems.push('output carries non-finite JSON values');
  if (problems.length) return problems;
  const identities = new Set<string>();
  for (const action of output.actions) {
    if (!action || typeof action !== 'object') problems.push('action is not an object');
    else {
      if (!ACTION_KINDS.includes(action.kind)) problems.push(`unknown action kind ${String(action.kind)}`);
      const identity = `${action.stepId}:${action.occurrence}`;
      if (identities.has(identity)) problems.push(`duplicate step identity ${identity}`);
      identities.add(identity);
      if (action.kind === 'provider.call' && typeof action.byteArgs === 'object' && action.args && Object.keys(action.byteArgs).some((slot) => Object.hasOwn(action.args, slot))) problems.push('byteArgs overlaps args');
      if (action.kind === 'hook.verify' && !HOOK_EVENTS.includes(action.event)) problems.push(`unknown hook event ${String(action.event)}`);
      if (action.kind === 'outcome.error' && !OUTCOME_CODES.includes(action.code)) problems.push(`unknown outcome code ${String(action.code)}`);
      if (action.kind === 'delivery.propose' && !DELIVERY_STATUSES.includes(action.status)) problems.push(`delivery status must be succeeded|partial`);
    }
  }
  const stateSerialized = JSON.stringify(output.state);
  if (byteLength(stateSerialized) > BUDGETS.stateBytes) problems.push(`state over ${BUDGETS.stateBytes} bytes`);
  budgetOk(output.state, 1, problems);
  return problems;
}

// Projects the frozen command-check original into verify subjects. The check arrives
// as bytes on the 'command-check' controlled slot in the sync tool's own shape:
// {result:{build,buildId,sourceSha256,ruleVersion,commands:[{command,status,head,
// arguments,violations,...}]},evidence:[]}. present is computed from the checked
// status — hit with no violations — never self-reported; the workbook projection's
// command list is passed as the second tool argument.
export function projectCommandTree(commands: string[], original?: Uint8Array) {
  if (!(original instanceof Uint8Array)) throw new Error('command-check original bytes are required');
  let parsed: any;
  try { parsed = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(original)); }
  catch { throw new Error('command-check original is not valid UTF-8 JSON'); }
  const checked: any[] = parsed?.result?.commands ?? parsed?.commands ?? [];
  if (!Array.isArray(checked) || checked.some((entry: any) => typeof entry?.command !== 'string'))
    throw new Error('command-check original carries no usable command list');
  const present = new Set(checked.filter((entry: any) => entry.status === 'hit' && !(entry.violations ?? []).length).map((entry: any) => entry.command));
  const list = Array.isArray(commands) ? commands.filter((c) => typeof c === 'string') : [];
  return { heads: list.map((command) => ({ command, present: present.has(command) })) };
}
