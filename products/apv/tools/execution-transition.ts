// Tool: APV 执行流状态转换(hub-execution-transition/1 的产品端 transition)。
// 确定性纯函数:输入冻结绑定、产品状态、当前输入与已核对观察;输出下一状态与
// 待执行动作。不执行 RPC、不写证据、不改 hub phase。
// 门禁与解析的全部输入来自冻结原件,不取客户端自报:
//   - 先 tool.call workbook.ts('workbook' 受控槽)读出 book;命令、主机、检查点
//     一律出自 book。
//   - verify.deviceCommand 的 present 由 command-tree 原件算出(流程内 tool.call
//     解析),不由 transition 自填 true。
//   - 函数契约取自 excel-contract 原件,逐主机核启用方法。
// 租约、beforeDispatch、终态核验由 hub 驱动与 worker 完成;env_prepare/bed_topology
// 作为只读 provider.call 观察(C 阶段补同租约 prepare)。终态已证后解析失败只降
// 交付为 partial,不变 failed。
// imports(hub 依赖集): 无(相对依赖 ./execution-contracts.ts、./environment.ts、
// ./refusal.ts 随模块冻结)
import { TRANSITION_SCHEMA, HOOK_EVENTS, type ActionKind } from './execution-contracts.ts';
import { environmentDevices, environmentBuild } from './environment.ts';
import { refusalFacts } from './refusal.ts';

const action = (kind: ActionKind, stepId: string, fields: Record<string, unknown> = {}, occurrence = 0) => ({ kind, stepId, occurrence, ...fields });
const observation = (input: any, stepId: string) => input.observations?.find((row: any) => row?.facts?.stepId === stepId);

const RESOURCE = 'gateway';

// A tree head projected from the frozen command-tree original. The projection tool
// emits [{command, present}]; present is computed against the frozen tree, never
// self-reported here.
export function transition(input: any) {
  const state = input.state ?? { stage: 'workbook' };
  const submission = input.currentInput?.value ?? {};
  const value = submission.value ?? {};
  const build = String(value.build ?? '');
  const result = (stage: string, actions: any[]) => ({ schema: TRANSITION_SCHEMA, state: { ...state, stage }, actions });

  // 拒绝解释只从 observation.facts.result 读原文:hub worker 把 gatewayRefusal 从
  // error.details 摘除后,原始拒绝文本记录在 facts.result(flow-worker 冻结 refusal
  // pointer 后的观察投影)。阶段映射:环境阶段网关自报 BUILD_MISMATCH 保持其码,
  // 其余按 refusalFacts 的码表;lease 不可用类拒绝映射 LEASE_UNAVAILABLE。
  const refusalError = (stepId: string, stageKind: string, observed: any) => {
    const original = observed?.facts?.result ?? null;
    const facts = refusalFacts(original);
    const code = stageKind === 'lease' ? 'LEASE_UNAVAILABLE' : facts.code;
    return result('failed', [action('outcome.error', stepId, { code, facts: { stage: stageKind, refusal: facts } })]);
  };

  // workbook: parse the frozen workbook original once; every gate and the parse feed
  // off this projection, never off client-supplied lists.
  if (state.stage === 'workbook') {
    const book = observation(input, 'workbook');
    if (!book)
      return result('workbook', [
        action('tool.call', 'workbook', { path: 'tools/workbook.ts', export: 'readExecutionWorkbook', args: [], byteSlots: ['workbook'] }),
      ]);
    if (book.facts.status !== 'succeeded') return result('failed', [action('outcome.error', 'workbook-failed', { code: book.facts.error?.code ?? 'HOOK_FAILED', facts: { stage: 'workbook' } })]);
    return result('environment', [action('provider.call', 'environment', { resource: RESOURCE, tool: 'env_prepare', args: { device_build: build } })]);
  }

  // environment: read-only env_prepare observation; conf mapping skips topology.
  if (state.stage === 'environment') {
    const prepare = observation(input, 'environment');
    if (!prepare) return result('environment', []);
    if (prepare.facts.status !== 'succeeded') return refusalError('environment-failed', 'environment', prepare);
    const environment = prepare.facts.result;
    const byConf = environmentDevices({ environment });
    if (byConf) return result('device-map', [action('tool.call', 'device-map', { path: 'tools/environment.ts', export: 'environmentDevices', args: [{ environment }] })]);
    return result('topology', [action('provider.call', 'topology', { resource: RESOURCE, tool: 'bed_topology', args: { refresh: false } })]);
  }

  if (state.stage === 'topology') {
    const topology = observation(input, 'topology');
    const prepare = observation(input, 'environment');
    if (!topology) return result('topology', []);
    const attribution = { environment: prepare?.facts?.result, topology: topology.facts.status === 'succeeded' ? topology.facts.result : null };
    return result('device-map', [action('tool.call', 'device-map', { path: 'tools/environment.ts', export: 'environmentDevices', args: [attribution] })]);
  }

  if (state.stage === 'device-map') {
    const map = observation(input, 'device-map');
    const prepare = observation(input, 'environment');
    if (!map) return result('device-map', []);
    if (map.facts.status !== 'succeeded') return result('failed', [action('outcome.error', 'device-map-failed', { code: 'EVIDENCE_INSUFFICIENT', facts: { stage: 'device-map' } })]);
    const buildCheck = environmentBuild(prepare?.facts?.result, build);
    if (!buildCheck.passed) return result('failed', [action('outcome.error', 'build-mismatch', { code: 'BUILD_MISMATCH', facts: { stage: 'device-map', buildCheck } })]);
    // present comes from the frozen command-check original (the sync tool's shape,
    // {result:{commands:[{command,status,violations}]}}), projected by a pure tool;
    // the workbook observation supplies the command list.
    const commands = ((observation(input, 'workbook')?.facts?.result ?? {}).commands ?? []).map((row: any) => row.command);
    return result('tree', [action('tool.call', 'tree', { path: 'tools/execution-contracts.ts', export: 'projectCommandTree', args: [commands], byteSlots: ['command-check'] })]);
  }

  if (state.stage === 'tree') {
    const tree = observation(input, 'tree');
    if (!tree) return result('tree', []);
    if (tree.facts.status !== 'succeeded') return result('failed', [action('outcome.error', 'tree-failed', { code: 'HOOK_FAILED', facts: { stage: 'tree' } })]);
    const heads = tree.facts.result.heads ?? [];
    // The workbook projection (from the earlier tool.call) and the tree heads drive
    // the verify gates; clients cannot widen or narrow either list.
    const book = observation(input, 'workbook')?.facts?.result ?? {};
    const actions = [
      ...(book.commands ?? []).map((row: any, index: number) => action('hook.verify', `verify-device-${index}`, {
        event: HOOK_EVENTS[0],
        subject: { command: row.command, tree: { heads } },
      })),
      ...(book.hostCommands ?? []).map((row: any, index: number) => action('hook.verify', `verify-host-${index}`, {
        event: HOOK_EVENTS[1],
        subject: { command: row.command, host: row.host, method: row.method ?? 'cmd', kwargs: row.kwargs ?? {} },
      })),
    ];
    // The workbook gate runs per distinct host in the book (native controller checks
    // each host command against the function contract).
    const hosts = [...new Set((book.hostCommands ?? []).map((row: any) => row.host))];
    for (const [index, host] of hosts.entries())
      actions.push(action('hook.verify', `verify-workbook-${index}`, { event: HOOK_EVENTS[2], subject: { client: host, contract: { testEnvEnabled: [] } } }));
    return result('verify', actions);
  }

  // verify: every gate succeeded; hub runs beforeDispatch at the write exit.
  if (state.stage === 'verify') {
    const book = observation(input, 'workbook')?.facts?.result ?? {};
    const expected = (book.commands?.length ?? 0) + (book.hostCommands?.length ?? 0) + new Set((book.hostCommands ?? []).map((row: any) => row.host)).size;
    const verifies = input.observations?.filter((row: any) => typeof row?.facts?.stepId === 'string' && row.facts.stepId.startsWith('verify-')) ?? [];
    if (verifies.length < Math.max(expected, 1)) return result('verify', []);
    const blocked = verifies.find((row: any) => row.facts.status !== 'succeeded');
    if (blocked) {
      // hub reports HOOK_FAILED; the rule code lives in details.code — keep the
      // registered code in the outcome, the rule code in facts.
      const ruleCode = blocked.facts.error?.details?.code ?? blocked.facts.error?.code ?? null;
      return result('failed', [action('outcome.error', 'verify-failed', { code: 'HOOK_FAILED', facts: { stage: 'verify', stepId: blocked.facts.stepId, ruleCode } })]);
    }
    return result('submit', [
      action('provider.call', 'submit', { resource: RESOURCE, tool: 'case_submit', args: { ...(value.module ? { module: value.module } : {}) }, byteArgs: { xlsx_b64: 'workbook' } }),
    ]);
  }

  // submit: the hub write chain verifies the receipt and the terminal state; the
  // observation's facts.result carries the result original (or its projection).
  if (state.stage === 'submit') {
    const submitted = input.observations?.find((row: any) => row?.facts?.stepId === 'submit' && row.facts.status !== undefined);
    if (!submitted) return result('submit', []);
    if (submitted.facts.status === 'running' || submitted.facts.status === 'unknown') return result('wait', [action('operation.wait', 'wait-terminal', { operationId: submitted.operationId })]);
    if (submitted.facts.status !== 'succeeded') return refusalError('submit-refused', 'submit', submitted);
    // The reconcile path reports a status receipt as the step result; ask the result
    // tool through the provider before parsing when the observation is not already
    // the result original.
    const carried = submitted.facts.result;
    if (carried && typeof carried === 'object' && Array.isArray((carried as any).cases) === false && (carried as any).state !== undefined)
      return result('result', [action('provider.call', 'result', { resource: RESOURCE, tool: 'case_results', args: { task_id: carried.task_id ?? null } })]);
    const raw = submitted.facts.result;
    const book = observation(input, 'workbook')?.facts?.result ?? { cases: [] };
    const attribution = { environment: observation(input, 'environment')?.facts?.result ?? null, topology: observation(input, 'topology')?.facts?.result ?? null };
    return result('parse', [
      action('tool.call', 'parse-results', { path: 'tools/results.ts', export: 'executionResults', args: [book, raw, attribution], byteSlots: ['workbook'] }),
    ]);
  }

  if (state.stage === 'result') {
    const resultObserved = observation(input, 'result');
    if (!resultObserved) return result('result', []);
    if (resultObserved.facts.status !== 'succeeded') return refusalError('result-failed', 'result', resultObserved);
    const raw = resultObserved.facts.result;
    const book = observation(input, 'workbook')?.facts?.result ?? { cases: [] };
    const attribution = { environment: observation(input, 'environment')?.facts?.result ?? null, topology: observation(input, 'topology')?.facts?.result ?? null };
    return result('parse', [
      action('tool.call', 'parse-results', { path: 'tools/results.ts', export: 'executionResults', args: [book, raw, attribution], byteSlots: ['workbook'] }),
    ]);
  }

  if (state.stage === 'wait') {
    // The write chain ends in one terminal observation; when the wait reports a
    // status-shaped receipt, pull the result original via the result tool.
    const waited = observation(input, 'wait-terminal') ?? input.observations?.find((row: any) => row?.facts?.stepId === 'submit');
    if (!waited) return result('wait', []);
    if (waited.facts.status === 'running' || waited.facts.status === 'unknown') return result('wait', []);
    if (waited.facts.status !== 'succeeded') return refusalError('wait-failed', 'submit', waited);
    return result('result', [action('provider.call', 'result', { resource: RESOURCE, tool: 'case_results', args: { task_id: waited.facts.result?.task_id ?? null } })]);

  }

  if (state.stage === 'parse') {
    const parsed = observation(input, 'parse-results');
    if (!parsed) return result('parse', []);
    // A parse failure after a proven terminal state degrades delivery to partial —
    // the device outcome stands; the interpretation does not.
    if (parsed.facts.status !== 'succeeded') return result('afterResult', [
      action('hook.verify', 'after-result', { event: HOOK_EVENTS[4], subject: { result: { parseFailed: true, error: parsed.facts.error ?? null }, operationId: input.observations?.find((row: any) => row?.facts?.stepId === 'submit')?.operationId ?? null } }),
    ]);
    const parsedResult = parsed.facts.result;
    return result('afterResult', [
      action('hook.verify', 'after-result', { event: HOOK_EVENTS[4], subject: { result: parsedResult, operationId: input.observations?.find((row: any) => row?.facts?.stepId === 'submit')?.operationId ?? null } }),
    ]);
  }

  if (state.stage === 'afterResult') {
    const checked = observation(input, 'after-result');
    if (!checked) return result('afterResult', []);
    const parsedResult = observation(input, 'parse-results')?.facts?.result;
    const parseFailed = parsedResult === undefined || parsedResult?.parseFailed === true;
    // unknown unmapped (a budget projection replaced the payload) or a parse failure
    // both mean partial; a real empty unmapped list means succeeded.
    const unmapped = Array.isArray(parsedResult?.unmapped) ? parsedResult.unmapped.length : null;
    const partial = parseFailed || unmapped === null ? true : unmapped > 0;
    return result('done', [
      action('delivery.propose', 'deliver', { status: partial ? 'partial' : 'succeeded', result: parsedResult ?? { parseFailed: true }, references: (input.observations ?? []).map((row: any) => row.reference) }),
    ]);
  }

  return result(state.stage, []);
}
