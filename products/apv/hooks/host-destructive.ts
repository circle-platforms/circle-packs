// Hook 处理器(hub-hook/1):verify.hostCommand — 主机 shell 命令拦自毁模式,正常命令放行。
// 判定 100% 可证真:命中自毁模式回 block + DESTRUCTIVE_COMMAND;其余(含 dig/curl/ping/tc)pass。
// 输入:{event:'verify.hostCommand', binding:{...}, subject}
// subject:{command:<string>} — 主机上要执行的 shell 命令行。
// 输出:{decision:'pass'} | {decision:'block', code, facts}
const DESTRUCTIVE = [
  /\brm\s+-[a-z]*r[a-z]*f/i, /\brm\s+-[a-z]*f[a-z]*r/i,
  /\bmkfs\b/i, /\bdd\s+.*\bof=\/dev\//i, /\bshutdown\b/i, /\breboot\b/i, /\bpoweroff\b/i, /\bhalt\b/i,
  /\bkillall\b/i, /\bkill\s+-9\s+-1\b/i, /\b:wq!?\b.*\/etc\//i, />\s*\/dev\/sd[a-z]/i, /\bchown\s+-R\s+\S*\s+\/\s*$/i,
  /\bchmod\s+-R\s+\S*\s+\/\s*$/i, /\biptables\s+-F\b/i, /\bip\s+link\s+\S+\s+delete\b/i, /\bformat\b/i,
];

export default function handle(input) {
  const subject = input?.subject ?? {};
  const command = typeof subject.command === 'string' ? subject.command : '';
  const matched = DESTRUCTIVE.find((pattern) => pattern.test(command));
  if (matched) return { decision: 'block', code: 'DESTRUCTIVE_COMMAND', facts: { command, pattern: String(matched), event: input?.event ?? null } };
  return { decision: 'pass' };
}
