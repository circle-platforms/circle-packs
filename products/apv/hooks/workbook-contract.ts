// Hook 处理器(hub-hook/1):verify.workbook — 工作簿里 test_env 行的客户端名必须在绑定的函数契约里。
// 判定 100% 可证真:客户端不在契约回 block + COMMAND_VALIDATION_FAILED;命中回 pass。
// 输入:{event:'verify.workbook', binding:{...}, subject}
// subject:{client:<string>, contract:{testEnvEnabled:[<names>]}} — 契约由绑定侧在调用前投影好。
// 输出:{decision:'pass'} | {decision:'block', code, facts}
export default function handle(input) {
  const subject = input?.subject ?? {};
  const client = typeof subject.client === 'string' ? subject.client.trim() : '';
  const enabled = Array.isArray(subject.contract?.testEnvEnabled) ? subject.contract.testEnvEnabled : [];
  if (!client) return { decision: 'block', code: 'COMMAND_VALIDATION_FAILED', facts: { reason: 'empty client', event: input?.event ?? null } };
  if (!enabled.includes(client))
    return { decision: 'block', code: 'COMMAND_VALIDATION_FAILED', facts: { client, event: input?.event ?? null } };
  return { decision: 'pass' };
}
