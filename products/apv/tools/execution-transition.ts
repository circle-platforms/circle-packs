// Tool: APV 执行流状态转换(hub-execution-transition/1 的产品端 transition)。
// 确定性纯函数:输入冻结绑定、产品状态、当前输入与已核对观察;输出下一状态与
// 待执行动作。不执行 RPC、不写证据、不改 hub phase。
// 接法(对照 hub flow-driver/flow-worker 与原生 worker/controller):
//   - hub 注入整份 FlowSubmission,currentInput.value.value 才是产品值;resources
//     按别名绑定,provider.call 的 resource 填绑定别名(如 "gateway")。
//   - 远端租约由 hub worker 在写 provider.call 外自动维持(acquire→intent→
//     submitted→heartbeat→release),transition 不发租约工具、不带租约参数。
//   - beforeDispatch 由 hub 在写出口强制执行,transition 不自发。
//   - 写 provider.call 提交后,hub 已核验终态并给出 result 观察;transition 用
//     operation.wait 等待同一操作,不自轮询 status/results。
// 阶段:environment(env_prepare 只读)→ [topology(仅缺映射时)] → device-map(环境
// Tool)→ verify(逐条设备命令 + 逐台主机命令)→ submit(xlsx_b64 受控槽)→ wait →
// parse(结果 Tool,book 参数)→ afterResult → deliver。
// imports(hub 依赖集): 无(相对依赖 ./execution-contracts.ts、./environment.ts、
// ./refusal.ts 随模块冻结)
import { TRANSITION_SCHEMA, HOOK_EVENTS, type ActionKind } from './execution-contracts.ts';
import { environmentDevices, environmentBuild } from './environment.ts';
import { refusalFacts } from './refusal.ts';

const action = (kind: ActionKind, stepId: string, fields: Record<string, unknown> = {}, occurrence = 0) => ({ kind, stepId, occurrence, ...fields });
const observation = (input: any, stepId: string) => input.observations?.find((row: any) => row?.facts?.stepId === stepId);

// The provider alias this flow addresses; the bound resources map is keyed by it.
const RESOURCE = 'gateway';

export function transition(input: any) {
  const state = input.state ?? { stage: 'environment' };
  // The hub injects the whole FlowSubmission: the product values live one level deeper.
  // The hub injects the whole FlowSubmission: the product payload is its value field.
  const submission = input.currentInput?.value ?? {};
  const value = submission.value ?? {};
  const build = String(value.build ?? '');
  const result = (stage: string, actions: any[]) => ({ schema: TRANSITION_SCHEMA, state: { ...state, stage }, actions });
  // 拒绝解释只从 observation 的原始回报取(hub 信封里没有网关原文);
  // 租约阶段的原生映射是 LEASE_UNAVAILABLE,其余按 refusalFacts 的码表。
  const refusalError = (stepId: string, stageKind: string, observed: any) => {
    // The hub envelope keeps the gateway original under error.details.gatewayRefusal
    // ({schema:'hub-provider-refusal/1', refusal:{...}}); unwrap both layers.
    const refusalEnvelope = observed?.facts?.error?.details?.gatewayRefusal ?? observed?.facts?.result?.gatewayRefusal ?? null;
    const gatewayOriginal = refusalEnvelope?.refusal ?? refusalEnvelope ?? observed?.facts?.error?.details ?? null;
    const facts = refusalFacts(gatewayOriginal);
    const code = stageKind === 'lease' ? 'LEASE_UNAVAILABLE' : facts.code;
    return result('failed', [action('outcome.error', stepId, { code, facts: { stage: stageKind, refusal: facts } })]);
  };

  // environment: one read-only env_prepare call (device_build rides in the worker's
  // lease arguments, not in ours); its observation carries the build check.
  if (state.stage === 'environment') {
    const prepare = observation(input, 'environment');
    if (!prepare) return result('environment', [action('provider.call', 'environment', { resource: RESOURCE, tool: 'env_prepare', args: { device_build: build } })]);
    if (prepare.facts.status !== 'succeeded') return refusalError('environment-failed', 'environment', prepare);
    // conf.device_ips 优先;取不到映射才补一次 bed_topology(失败不致命,留未映射)。
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
    // 逐条设备命令 verify.deviceCommand;逐台主机命令 verify.hostCommand(与原生
    // controller 的 gate 相同的 subject 形状)。命令清单来自冻结的工作簿投影。
    const commands: any[] = value.deviceCommands ?? [];
    const hosts: any[] = value.hostDispatches ?? [];
    const actions = [
      ...commands.map((row, index) => action('hook.verify', `verify-device-${index}`, {
        event: HOOK_EVENTS[0],
        subject: { command: row.command, tree: { heads: [{ command: row.command, present: true }] } },
      })),
      ...hosts.map((row, index) => action('hook.verify', `verify-host-${index}`, {
        event: HOOK_EVENTS[1],
        subject: { command: row.command, host: row.host, method: row.method ?? 'cmd', kwargs: row.kwargs ?? {} },
      })),
    ];
    return result('verify', actions.length ? actions : [action('hook.verify', 'verify-workbook', { event: HOOK_EVENTS[2], subject: { client: value.client ?? '', contract: { testEnvEnabled: value.testEnvEnabled ?? [] } } })]);
  }

  // verify: all verify hooks must have succeeded; then the single write submission.
  if (state.stage === 'verify') {
    const verifies = input.observations?.filter((row: any) => typeof row?.facts?.stepId === 'string' && row.facts.stepId.startsWith('verify-')) ?? [];
    const expected = (value.deviceCommands?.length ?? 0) + (value.hostDispatches?.length ?? 0);
    if (verifies.length < Math.max(expected, 1)) return result('verify', []);
    const blocked = verifies.find((row: any) => row.facts.status !== 'succeeded');
    if (blocked) return result('failed', [action('outcome.error', 'verify-failed', { code: blocked.facts.error?.code === 'HOST_NOT_IN_BED' ? 'HOST_NOT_IN_BED' : 'COMMAND_NOT_IN_TREE', facts: { stage: 'verify', stepId: blocked.facts.stepId } })]);
    return result('submit', [
      action('provider.call', 'submit', {
        resource: RESOURCE,
        tool: 'case_submit',
        args: { ...(value.module ? { module: value.module } : {}) },
        byteArgs: { xlsx_b64: 'workbook' },
      }),
    ]);
  }

  // submit: hub's write chain verifies the receipt (sha256, case_ids) and drives the
  // remote to a terminal state; the observation arrives with facts.result. We never
  // poll status/results ourselves — operation.wait on the very write we dispatched.
  if (state.stage === 'submit') {
    const submitted = input.observations?.find((row: any) => row?.facts?.stepId === 'submit' && row.facts.status !== undefined);
    if (!submitted) return result('submit', []);
    if (submitted.facts.status === 'running' || submitted.facts.status === 'unknown') return result('wait', [action('operation.wait', 'wait-terminal', { operationId: submitted.operationId })]);
    if (submitted.facts.status !== 'succeeded') return refusalError('submit-refused', 'submit', submitted);
    return result('parse', [
      action('tool.call', 'parse-results', {
        path: 'tools/results.ts',
        export: 'executionResults',
        args: [value.workbookBook, submitted.facts.result, { environment: observation(input, 'environment')?.facts?.result, topology: observation(input, 'topology')?.facts?.result ?? null }],
        byteSlots: ['workbook'],
      }),
    ]);
  }

  if (state.stage === 'wait') {
    const waited = observation(input, 'wait-terminal') ?? input.observations?.find((row: any) => row?.facts?.stepId === 'submit');
    if (!waited) return result('wait', []);
    if (waited.facts.status === 'running' || waited.facts.status === 'unknown') return result('wait', []);
    if (waited.facts.status !== 'succeeded') return refusalError('wait-failed', 'submit', waited);
    return result('parse', [
      action('tool.call', 'parse-results', {
        path: 'tools/results.ts',
        export: 'executionResults',
        args: [value.workbookBook, waited.facts.result, { environment: observation(input, 'environment')?.facts?.result, topology: observation(input, 'topology')?.facts?.result ?? null }],
        byteSlots: ['workbook'],
      }),
    ]);
  }

  if (state.stage === 'parse') {
    const parsed = observation(input, 'parse-results');
    if (!parsed) return result('parse', []);
    if (parsed.facts.status !== 'succeeded') return result('failed', [action('outcome.error', 'parse-failed', { code: 'EVIDENCE_INSUFFICIENT', facts: { stage: 'parse', error: parsed.facts.error ?? null } })]);
    const parsedResult = parsed.facts.result;
    // A hub budget projection replaces the payload with {original}; unmapped is then
    // unknown — never report succeeded on a projection without an unmapped list.
    const unmapped = Array.isArray(parsedResult?.unmapped) ? parsedResult.unmapped.length : null;
    return result('afterResult', [
      action('hook.verify', 'after-result', { event: HOOK_EVENTS[4], subject: { result: parsedResult, operationId: observation(input, 'submit')?.operationId ?? input.observations?.find((row: any) => row?.facts?.stepId === 'submit')?.operationId ?? null } }),
    ]);
  }

  if (state.stage === 'afterResult') {
    const checked = observation(input, 'after-result');
    if (!checked) return result('afterResult', []);
    if (checked.facts.status !== 'succeeded') return result('failed', [action('outcome.error', 'after-result-failed', { code: checked.facts.error?.code ?? 'HOOK_FAILED', facts: { stage: 'afterResult' } })]);
    const parsedResult = observation(input, 'parse-results')?.facts?.result;
    const unmapped = Array.isArray(parsedResult?.unmapped) ? parsedResult.unmapped.length : null;
    const hasUnmapped = unmapped === null ? true : unmapped > 0; // unknown unmapped ⇒ partial, not succeeded
    return result('done', [
      action('delivery.propose', 'deliver', {
        status: hasUnmapped ? 'partial' : 'succeeded',
        result: parsedResult,
        references: (input.observations ?? []).map((row: any) => row.reference),
      }),
    ]);
  }

  return result(state.stage, []);
}
