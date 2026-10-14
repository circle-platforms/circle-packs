// Tool: APV 执行流状态转换(hub-execution-transition/1 的产品端 transition)。
// 确定性纯函数:输入冻结绑定、产品状态、当前输入与已核对观察;输出下一状态与
// 待执行动作。不执行 RPC、不写证据、不改 hub phase。工作簿字节经 byteArgs 的
// 受控槽引用,不内联 base64。阶段:
//   lease → environment(env_prepare+bed_topology 观察)→ device-map(环境 Tool)
//   → verify(三个 verify Hook + beforeDispatch)→ submit(byteArgs 工作簿)
//   → wait(status 轮询)→ result → parse(结果 Tool,受控日志槽)→ afterResult
//   → deliver(delivery.propose);任何阶段的可证失败走 outcome.error。
// imports(hub 依赖集): 无(相对依赖 ./execution-contracts.ts、./environment.ts、
// ./refusal.ts 随模块冻结)
import { TRANSITION_SCHEMA, PROVIDER_TOOLS, type ActionKind, type HookEvent } from './execution-contracts.ts';
import { environmentDevices, environmentBuild } from './environment.ts';
import { refusalFacts } from './refusal.ts';

const action = (kind: ActionKind, stepId: string, fields: Record<string, unknown> = {}, occurrence = 0) => ({ kind, stepId, occurrence, ...fields });
const observation = (input: any, stepId: string) => input.observations?.find((row: any) => row?.facts?.stepId === stepId && row.facts.occurrence === undefined) ?? input.observations?.find((row: any) => row?.facts?.stepId === stepId);

export function transition(input: any) {
  const state = input.state ?? { stage: 'lease' };
  const value = input.currentInput?.value ?? {};
  const build = String(value.build ?? '');
  const gateway = String(value.gatewayAssetId ?? '');
  const result = (stage: string, actions: any[]) => ({ schema: TRANSITION_SCHEMA, state: { ...state, stage }, actions });
  const failed = (stepId: string, code: string, facts: Record<string, unknown>) => result('failed', [action('outcome.error', stepId, { code, facts })]);

  // lease: acquire the remote lease; the observation carries the granted lease facts.
  if (state.stage === 'lease') {
    const lease = observation(input, 'lease');
    if (!lease) return result('leasing', [action('provider.call', 'lease', { resource: gateway, tool: PROVIDER_TOOLS.lease.acquireTool, args: {} })]);
    if (lease.facts.status !== 'succeeded') {
      const refusal = refusalFacts(lease.facts.error ?? lease.facts.result);
      return failed('lease-failed', refusal.code, { stage: 'lease', refusal });
    }
    return result('environment', [action('provider.call', 'environment', { resource: gateway, tool: PROVIDER_TOOLS.prepareTool, args: {}, ...(lease.facts.lease ? { leaseArgs: lease.facts.lease } : {}) })]);
  }

  // environment: env_prepare observation; build check runs on the returned facts.
  if (state.stage === 'environment') {
    const prepare = observation(input, 'environment');
    if (!prepare) return result('environment', []);
    if (prepare.facts.status !== 'succeeded') {
      const refusal = refusalFacts(prepare.facts.error ?? prepare.facts.result);
      return failed('environment-failed', refusal.code, { stage: 'environment', refusal });
    }
    return result('topology', [action('provider.call', 'topology', { resource: gateway, tool: PROVIDER_TOOLS.topologyTool, args: {} })]);
  }

  // topology observation → device map via the environment Tool (pure interpretation).
  if (state.stage === 'topology') {
    const topology = observation(input, 'topology');
    if (!topology) return result('topology', []);
    if (topology.facts.status !== 'succeeded') return failed('topology-failed', 'GATEWAY_REFUSED', { stage: 'topology' });
    return result('device-map', [
      action('tool.call', 'device-map', {
        path: 'tools/environment.ts',
        export: 'environmentDevices',
        args: [{ environment: observation(input, 'environment')?.facts?.result, topology: topology.facts.result }],
      }),
    ]);
  }

  if (state.stage === 'device-map') {
    const map = observation(input, 'device-map');
    if (!map) return result('device-map', []);
    if (map.facts.status !== 'succeeded') return failed('device-map-failed', 'DEVICE_MAP_UNAVAILABLE', { stage: 'device-map' });
    const devices = map.facts.result;
    const buildCheck = environmentBuild(observation(input, 'environment')?.facts?.result, build);
    if (!buildCheck.passed) return failed('build-mismatch', 'BUILD_MISMATCH', { stage: 'device-map', buildCheck });
    return result('verify', [
      action('hook.verify', 'verify-workbook', { event: 'verify.workbook' as HookEvent, subject: { client: value.client, contract: { testEnvEnabled: value.testEnvEnabled ?? [] } } }),
    ]);
  }

  // verify: the three verify hooks plus beforeDispatch, then submit.
  if (state.stage === 'verify') {
    const workbook = observation(input, 'verify-workbook');
    if (!workbook) return result('verify', []);
    if (workbook.facts.status !== 'succeeded') return failed('verify-failed', workbook.facts.error?.code ?? 'COMMAND_VALIDATION_FAILED', { stage: 'verify', hook: 'verify.workbook' });
    const submitArgs = { build, deadline_ms: value.deadlineMs ?? 3600000 };
    return result('submit', [
      action('provider.call', 'submit', {
        resource: gateway,
        tool: PROVIDER_TOOLS.submitTool,
        args: submitArgs,
        byteArgs: { workbook_b64: 'workbook' },
      }),
      action('hook.verify', 'before-dispatch', { event: 'beforeDispatch' as HookEvent, subject: { input: value, operationId: 'submit' } }),
    ]);
  }

  // submit: refusal interpretation or the remote task id; then wait on status.
  if (state.stage === 'submit') {
    const submitted = observation(input, 'submit');
    if (!submitted) return result('submit', []);
    if (submitted.facts.status !== 'succeeded') {
      const refusal = refusalFacts(submitted.facts.error ?? submitted.facts.result);
      return failed('submit-refused', refusal.code, { stage: 'submit', refusal });
    }
    const remoteId = submitted.facts.remoteId ?? submitted.facts.result?.task_id;
    return result('wait', [action('provider.call', 'status', { resource: gateway, tool: PROVIDER_TOOLS.statusTool, args: { [PROVIDER_TOOLS.taskIdArgument]: remoteId } })]);
  }

  if (state.stage === 'wait') {
    const status = observation(input, 'status');
    if (!status) return result('wait', []);
    if (status.facts.status !== 'succeeded') return failed('status-failed', 'GATEWAY_REFUSED', { stage: 'status' });
    const state_ = status.facts.result?.state ?? status.facts.state;
    if (state_ !== 'done') return result('wait', [action('operation.wait', 'wait-status', { operationId: status.operationId })]);
    const remoteId = status.facts.remoteId ?? status.facts.result?.task_id;
    return result('result', [action('provider.call', 'result', { resource: gateway, tool: PROVIDER_TOOLS.resultTool, args: { [PROVIDER_TOOLS.taskIdArgument]: remoteId } })]);
  }

  if (state.stage === 'result') {
    const resultObserved = observation(input, 'result');
    if (!resultObserved) return result('result', []);
    if (resultObserved.facts.status !== 'succeeded') return failed('result-failed', 'GATEWAY_REFUSED', { stage: 'result' });
    return result('parse', [
      action('tool.call', 'parse-results', {
        path: 'tools/results.ts',
        export: 'executionResults',
        args: [{ workbook: { cases: value.workbookProjection } }, resultObserved.facts.result, { environment: observation(input, 'environment')?.facts?.result, topology: observation(input, 'topology')?.facts?.result }],
        byteSlots: ['workbook', 'results'],
      }),
    ]);
  }

  if (state.stage === 'parse') {
    const parsed = observation(input, 'parse-results');
    if (!parsed) return result('parse', []);
    if (parsed.facts.status !== 'succeeded') return failed('parse-failed', 'CHECKPOINT_UNMAPPED', { stage: 'parse' });
    const parsedResult = parsed.facts.result;
    return result('afterResult', [
      action('hook.verify', 'after-result', { event: 'afterResult' as HookEvent, subject: { result: parsedResult, operationId: observation(input, 'submit')?.operationId ?? null } }),
    ]);
  }

  if (state.stage === 'afterResult') {
    const checked = observation(input, 'after-result');
    if (!checked) return result('afterResult', []);
    if (checked.facts.status !== 'succeeded') return failed('after-result-failed', checked.facts.error?.code ?? 'GATEWAY_REFUSED', { stage: 'afterResult' });
    const parsedResult = observation(input, 'parse-results')?.facts?.result;
    const unmapped = parsedResult?.unmapped?.length ?? 0;
    return result('done', [
      action('delivery.propose', 'deliver', {
        status: unmapped ? 'partial' : 'succeeded',
        result: parsedResult,
        references: (input.observations ?? []).map((row: any) => row.reference),
      }),
    ]);
  }

  return result(state.stage, []);
}
