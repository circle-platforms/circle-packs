// Hook 处理器(hub-hook/1):verify.hostCommand — 主机 shell 三条主机策略,全部 100% 可证真。
// 挂在 host-destructive 之后:自毁命令先被拦,本处理器只管「这张床允许哪些主机、命令是否字面量、
// 单主机策略是否缩小」。
// 输入:{event:'verify.hostCommand', binding:{method, resource:{assetId, version, sha256,
//   declaration}}, subject:{command, host, method, kwargs}}
// declaration 是资源资产已批准版本的声明原样;allowedTestHosts 是主机闭集,
// hostCommandPolicies 是可选的单主机前缀策略(只能缩小,不能放行闭集外主机)。
// 输出:{decision:'pass'} | {decision:'block', code, facts}
// a) host 不在 allowedTestHosts → HOST_NOT_IN_BED(闭集缺失或空 → HOST_SET_UNDECLARED)
// b) 命令含模板/替换语法 → COMMAND_NOT_LITERAL
// c) hostCommandPolicies[host] 存在时命令必须以其 allowPrefixes 之一开头 → HOST_COMMAND_OUTSIDE_POLICY

const TEMPLATE_PATTERNS = [
  { pattern: /\{\{[\s\S]*?\}\}/, label: '{{ }}' },
  { pattern: /\$\{[^}]*\}/, label: '${ }' },
  { pattern: /\$\([^)]*\)/, label: '$( )' },
  { pattern: /`[^`]*`/, label: 'backtick' },
  // 未配对的 $NAME 变量引用:出现即视为模板,shell 不做字面量
  { pattern: /\$[A-Za-z_][A-Za-z0-9_]*(?![A-Za-z0-9_])/, label: '$NAME' },
];

export default function handle(input) {
  const subject = input?.subject ?? {};
  const declaration = input?.binding?.resource?.declaration ?? null;
  const command = typeof subject.command === 'string' ? subject.command : '';
  const host = typeof subject.host === 'string' ? subject.host : '';

  // (a) 主机闭集:缺失或空视为未声明,一律拦。
  const allowed = Array.isArray(declaration?.allowedTestHosts) ? declaration.allowedTestHosts.filter((h) => typeof h === 'string') : [];
  if (!allowed.length)
    return { decision: 'block', code: 'HOST_SET_UNDECLARED', facts: { host, event: input?.event ?? null } };
  if (!allowed.includes(host))
    // 闭集大小可证真;闭集内容不进审计。
    return { decision: 'block', code: 'HOST_NOT_IN_BED', facts: { host, allowedCount: allowed.length, event: input?.event ?? null } };

  // (b) 字面量:模板/替换语法一条都不许出现。
  for (const { pattern, label } of TEMPLATE_PATTERNS) {
    const match = pattern.exec(command);
    if (match)
      return { decision: 'block', code: 'COMMAND_NOT_LITERAL', facts: { host, syntax: label, fragment: match[0], event: input?.event ?? null } };
  }

  // (c) 单主机前缀策略:只能缩小。策略存在且命令不以其任一前缀开头 → 拦。
  const policy = declaration?.hostCommandPolicies?.[host];
  if (policy && Array.isArray(policy.allowPrefixes)) {
    const prefixes = policy.allowPrefixes.filter((p) => typeof p === 'string' && p);
    if (prefixes.length && !prefixes.some((p) => command.startsWith(p)))
      return { decision: 'block', code: 'HOST_COMMAND_OUTSIDE_POLICY', facts: { host, prefixCount: prefixes.length, event: input?.event ?? null } };
  }

  return { decision: 'pass' };
}
