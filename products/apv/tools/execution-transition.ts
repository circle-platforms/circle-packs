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
import { presentHeads } from './command-check.ts';

const action = (kind: ActionKind, stepId: string, fields: Record<string, unknown> = {}, occurrence = 0) => ({ kind, stepId, occurrence, ...fields });
// A stepId may have several occurrences; the current observation is the one whose
// occurrence is the latest completed per C's expectedOccurrences (nextOccurrence - 1) —
// never the first array row. Its operationId then identifies the step's real operation
// (operation.wait targets it). Without expectedOccurrences, fall back to the highest
// occurrence present.
const observation = (input: any, stepId: string) => {
  const rows = (input.observations ?? []).filter((row: any) => row?.facts?.stepId === stepId);
  if (rows.length <= 1) return rows[0];
  const expected = (input.expectedOccurrences ?? []).find((row: any) => row?.stepId === stepId);
  const current = expected ? Number(expected.nextOccurrence) - 1 : Math.max(...rows.map((row: any) => Number(row.facts?.occurrence ?? 0)));
  return rows.find((row: any) => Number(row.facts?.occurrence) === current) ?? rows[rows.length - 1];
};

// The book every stage reads: the slim re-projection once hub projected the full one
// into a hub.result slot, otherwise the plain projection. A bare {original:{slot}}
// pointer is never the book.
const bookResult = (input: any) => {
  const slim = observation(input, 'workbook-slim');
  if (slim) return slim.facts?.result ?? {};
  const full = observation(input, 'workbook')?.facts?.result;
  return full && !full.original?.slot ? full : {};
};

const RESOURCE = 'gateway';

// A tree head projected from the frozen command-tree original. The projection tool
// emits [{command, present}]; present is computed against the frozen tree, never
// self-reported here.
// Builds the parse action. The raw result rides the hub's dynamic result slot when the
// observation was projected ({original:{slot}} — the frame carries those bytes); the
// frozen workbook original rides its 'workbook' slot. Literal args stay tiny: only the
// attribution facts. results.ts signature: (book, raw, attribution, workbookBytes?).
// Builds the parse action. book is the slim projection observation (small by design —
// descriptions live only in the retained original) and raw is the terminal observation's
// facts result (already inside the frame budget); both ride literal args. The frozen
// workbook bytes ride the 'workbook' byte slot as the trailing parameter, and a
// hub-projected raw adds its dynamic result slot so results.ts reads real bytes.
function parseAction(input: any, raw: any, stepIdOfResult: string) {
  void stepIdOfResult;
  const slot = raw && typeof raw === 'object' && raw.original?.slot ? raw.original.slot : null;
  const book = bookResult(input).cases ? bookResult(input) : { cases: [] };
  const attribution = { environment: observation(input, 'environment')?.facts?.result ?? null, topology: observation(input, 'topology')?.facts?.result ?? null };
  const args = [book, raw ?? {}, attribution];
  const byteSlots = ['workbook'];
  if (slot) byteSlots.push(slot);
  return { schema: TRANSITION_SCHEMA, state: { ...(input.state ?? {}), stage: 'parse' }, actions: [action('tool.call', 'parse-results', { path: 'tools/results.ts', export: 'executionResults', args, byteSlots })] };
}

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
    // A refusal original lives in facts.result; a NON-refusal failure (timeout, credential)
    // leaves facts.result as {} and carries its own hub error code in facts.error.code —
    // pass that through verbatim instead of inventing GATEWAY_REFUSED.
    const error = observed?.facts?.error;
    if (error?.code && !(observed?.facts?.result && Object.keys(observed.facts.result).length))
      return result('failed', [action('outcome.error', stepId, { code: error.code, facts: { stage: stageKind, error: { code: error.code, message: error.message ?? null } } })]);
    const facts = refusalFacts(observed?.facts?.result ?? null);
    return result('failed', [action('outcome.error', stepId, { code: facts.code, facts: { stage: stageKind, refusal: facts } })]);
  };

  // workbook: parse the frozen workbook original once; every gate and the parse feed
  // off this projection, never off client-supplied lists.
  if (state.stage === 'workbook') {
    const book = observation(input, 'workbook');
    if (!book)
      return result('workbook', [
        action('tool.call', 'workbook', { path: 'tools/workbook.ts', export: 'projectWorkbook', args: [], byteSlots: ['workbook', 'function-contract'] }),
      ]);
    if (book.facts.status !== 'succeeded') return result('failed', [action('outcome.error', 'workbook-failed', { code: book.facts.error?.code ?? 'HOOK_FAILED', facts: { stage: 'workbook' } })]);
    // An oversized projection is hub-projected into {original:{slot}} pointing at the dynamic
    // hub.result slot; the frame carries that slot's retained bytes in controlledBytes. The
    // pointer is NOT the book — re-project a slim copy from the actual slot bytes (a second
    // Tool call that references the real hub slot, never a fabricated one).
    const projected = book.facts.result?.original?.slot;
    if (projected) {
      const slim = observation(input, 'workbook-slim');
      if (!slim)
        return result('workbook', [
          action('tool.call', 'workbook-slim', { path: 'tools/workbook.ts', export: 'projectWorkbookSlim', args: [], byteSlots: [projected] }),
        ]);
      if (slim.facts.status !== 'succeeded') return result('failed', [action('outcome.error', 'workbook-slim-failed', { code: slim.facts.error?.code ?? 'HOOK_FAILED', facts: { stage: 'workbook' } })]);
    }
    return result('environment', [action('provider.call', 'environment', { resource: RESOURCE, tool: 'env_prepare', args: {} })]);
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
    // Two command-source shapes, both frozen originals:
    // - XML original in the 'command-tree' slot (the real bed's source artifact): the
    //   flow itself parses and checks it via tools/command-tree.ts + tools/command-check.ts,
    //   so no pre-computed check original is needed.
    // - JSON command-check original (synthetic fixtures): projected by projectCommandTree.
    const commands = (bookResult(input).commands ?? []).map((row: any) => row.command);
    // The command-tree slot may carry the real bed's XML original or the synthetic
    // fixture's JSON tree; skip the UTF-8 BOM and leading whitespace, then '<' means XML.
    const treeSlot = input.controlledBytes?.find((entry: any) => entry.slot === 'command-tree');
    // skip a UTF-8 BOM and leading whitespace, then look for the XML '<'
    const probeBytes = treeSlot?.contentBase64 ? Buffer.from(treeSlot.contentBase64, 'base64') : null;
    let offset = 0;
    if (probeBytes?.subarray(0, 3).equals(Buffer.from([0xEF, 0xBB, 0xBF]))) offset = 3; // UTF-8 BOM
    while (offset < (probeBytes?.length ?? 0) && [0x20, 0x0a, 0x0d, 0x09].includes(probeBytes[offset])) offset++;
    const probe = probeBytes ? probeBytes.subarray(offset, offset + 1).toString('latin1') : null;
    if (treeSlot && probe === '<') {
      const identity = { build, buildId: build };
      return result('tree', [action('tool.call', 'tree', { path: 'tools/command-check.ts', export: 'checkCommands', args: [commands, identity], byteSlots: ['command-tree'] })]);
    }
    const expected = { build, ...(treeSlot?.reference?.sha256 ? { sourceSha256: treeSlot.reference.sha256 } : {}) };
    return result('tree', [action('tool.call', 'tree', { path: 'tools/execution-contracts.ts', export: 'projectCommandTree', args: [commands, expected], byteSlots: ['command-check'] })]);
  }

  if (state.stage === 'tree') {
    const tree = observation(input, 'tree');
    if (!tree) return result('tree', []);
    if (tree.facts.status !== 'succeeded') return result('failed', [action('outcome.error', 'tree-failed', { code: 'HOOK_FAILED', facts: { stage: 'tree' } })]);
    // Both command-source shapes yield heads under one rule; a receipt without heads
    // (older shape) derives them with the shared presentHeads predicate.
    const rawHeads = tree.facts.result.heads;
    const heads = Array.isArray(rawHeads) ? rawHeads : presentHeads(tree.facts.result.commands ?? []);
    // Each device gate carries ONLY its own head: the hook reads present for its own
    // command, and a shared full head list would square the output size (216 commands
    // ≈ 2.8 MB, far over the 256 KiB budget). Source of truth stays the projection.
    const headFor = (command: string) => heads.filter((head: any) => head.command === command).slice(0, 1);
    const book = bookResult(input);
    const actions = [
      ...(book.commands ?? []).map((row: any, index: number) => action('hook.verify', `verify-device-${index}`, {
        event: HOOK_EVENTS[0],
        subject: { command: row.command, tree: { heads: headFor(row.command) } },
      })),
      ...(book.hostCommands ?? []).map((row: any, index: number) => action('hook.verify', `verify-host-${index}`, {
        event: HOOK_EVENTS[1],
        subject: { command: row.command, host: row.host, method: row.method ?? 'cmd', kwargs: row.kwargs ?? {} },
      })),
    ];
    // The workbook gate runs per distinct host in the book (native controller checks
    // each host command against the function contract). testEnvEnabled is the enabled
    // list of the checked function contract itself — the workbook projection carries
    // its per-row annotations from the frozen function-contract original.
    const hosts = [...new Set((book.hostCommands ?? []).map((row: any) => row.host))];
    const enabledHosts = hosts.filter((host) => (book.hostCommands ?? []).some((row: any) => row.host === host && row.functionStatus === 'enabled'));
    for (const [index, host] of hosts.entries())
      actions.push(action('hook.verify', `verify-workbook-${index}`, { event: HOOK_EVENTS[2], subject: { client: host, contract: { testEnvEnabled: enabledHosts } } }));
    return result('verify', actions);
  }

  // verify: every gate succeeded; hub runs beforeDispatch at the write exit.
  if (state.stage === 'verify') {
    const book = bookResult(input);
    const expected = (book.commands?.length ?? 0) + (book.hostCommands?.length ?? 0) + new Set((book.hostCommands ?? []).map((row: any) => row.host)).size;
    const verifies = input.observations?.filter((row: any) => typeof row?.facts?.stepId === 'string' && row.facts.stepId.startsWith('verify-')) ?? [];
    if (verifies.length < Math.max(expected, 1)) return result('verify', []);
    // Gates can fail together; report the first in emission order (device → host →
    // workbook), never the frame's storage order.
    const blocked = ['verify-device-', 'verify-host-', 'verify-workbook-']
      .map((prefix) => verifies.find((row: any) => row.facts.stepId.startsWith(prefix) && row.facts.status !== 'succeeded'))
      .find(Boolean);
    if (blocked) {
      // hub reports HOOK_FAILED; the rule code lives in details.code — keep the
      // registered code in the outcome, the rule code in facts.
      const ruleCode = blocked.facts.error?.details?.code ?? blocked.facts.error?.code ?? null;
      return result('failed', [action('outcome.error', 'verify-failed', { code: 'HOOK_FAILED', facts: { stage: 'verify', stepId: blocked.facts.stepId, code: ruleCode } })]);
    }
    return result('submit', [
      // device_build / module 由资源批准的 toolArguments 映射注入（inputPath 指向冻结输入的
      // value.build、literal 固定模块）；产品动作给同名参数会被 hub 拒绝，这里一律不写。
      action('provider.call', 'submit', { resource: RESOURCE, tool: 'case_submit', args: {}, byteArgs: { xlsx_b64: 'workbook' } }),
    ]);
  }

  // submit: the hub write chain verifies the receipt and the terminal state; the
  // observation's facts.result carries the result original (or its projection).
  if (state.stage === 'submit') {
    const submitted = observation(input, 'submit');
    if (!submitted) return result('submit', []);
    if (submitted.facts.status === 'running' || submitted.facts.status === 'unknown') return result('wait', [action('operation.wait', 'wait-terminal', { operationId: submitted.operationId })]);
    if (submitted.facts.status !== 'succeeded') return refusalError('submit-refused', 'submit', submitted);
    // The reconcile path reports a status receipt as the step result; ask the result
    // tool through the provider before parsing when the observation is not already
    // the result original.
    const carried = submitted.facts.result;
    if (carried && typeof carried === 'object' && Array.isArray((carried as any).cases) === false && (carried as any).state !== undefined)
      return result('result', [action('provider.call', 'result', { resource: RESOURCE, tool: 'case_results', args: { task_id: carried.task_id ?? null } })]);
    return parseAction(input, submitted.facts.result, 'submit');
  }

  // wait: the operation.wait observation lands on the same stepId; when the write chain
  // reports its terminal observation we go straight to parsing via the result slot.
  if (state.stage === 'wait') {
    const waited = observation(input, 'submit');
    if (!waited || waited.facts.status === 'running' || waited.facts.status === 'unknown') return result('wait', []);
    if (waited.facts.status !== 'succeeded') return refusalError('wait-failed', 'submit', waited);
    return parseAction(input, waited.facts.result, 'submit');
  }

  if (state.stage === 'result') {
    const resultObserved = observation(input, 'result');
    if (!resultObserved) return result('result', []);
    if (resultObserved.facts.status !== 'succeeded') return refusalError('result-failed', 'result', resultObserved);
    return parseAction(input, resultObserved.facts.result, 'result');
  }


  if (state.stage === 'parse') {
    const parsed = observation(input, 'parse-results');
    if (!parsed) return result('parse', []);
    // One canonical delivery candidate: on a parse failure (hub records facts.result as
    // {} for a failed Tool) the candidate carries parseFailed; on success it is the
    // parsed result. The SAME object goes to the afterResult Hook and to delivery —
    // the delivery gate compares candidate bytes with the Hook subject.
    const operationId = input.observations?.find((row: any) => row?.facts?.stepId === 'submit')?.operationId ?? null;
    const candidate = parsed.facts.status === 'succeeded' ? parsed.facts.result : { parseFailed: true, error: parsed.facts.error ?? null };
    return result('afterResult', [
      action('hook.verify', 'after-result', { event: HOOK_EVENTS[4], subject: { result: candidate, operationId } }),
    ]);
  }

  if (state.stage === 'afterResult') {
    const checked = observation(input, 'after-result');
    if (!checked) return result('afterResult', []);
    // The delivery candidate is the canonical candidate from the parse stage — the same
    // object the afterResult Hook received as its subject (hub's delivery gate compares
    // the candidate with that subject). The hook's own observation carries handler
    // decisions, not the candidate, so the candidate is re-derived identically here.
    const parseObserved = observation(input, 'parse-results');
    const parsedResult = parseObserved?.facts?.status === 'succeeded' ? parseObserved.facts.result : { parseFailed: true, error: parseObserved?.facts?.error ?? null };
    const parseFailed = parsedResult?.parseFailed === true;
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
