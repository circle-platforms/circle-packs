// Hook 处理器(hub-hook/1):verify.deviceCommand — 设备命令必须在绑定的命令树里。
// 判定 100% 可证真:命令不在树里回 block + COMMAND_NOT_IN_TREE;命中回 pass。
// 输入:{event:'verify.deviceCommand', binding:{method,resource,source,inputRevision}, subject}
// subject:{command:<string>, tree:{heads:[{command, present}]}} — tree 由绑定侧在调用前投影好。
// 输出:{decision:'pass'} | {decision:'block', code, facts}
export default function handle(input) {
  const subject = input?.subject ?? {};
  const command = typeof subject.command === 'string' ? subject.command.trim() : '';
  const heads = Array.isArray(subject.tree?.heads) ? subject.tree.heads : [];
  if (!command) return { decision: 'block', code: 'COMMAND_NOT_IN_TREE', facts: { reason: 'empty command', event: input?.event ?? null } };
  const hit = heads.some((head) => head && typeof head.command === 'string' && head.command.trim() === command && head.present === true);
  if (!hit) return { decision: 'block', code: 'COMMAND_NOT_IN_TREE', facts: { command, event: input?.event ?? null } };
  return { decision: 'pass' };
}
