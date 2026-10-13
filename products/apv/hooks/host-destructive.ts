// Hook 处理器(hub-hook/1):verify.hostCommand — 主机 shell 命令拦自毁模式,正常命令放行。
// 判定 100% 可证真:命中自毁模式回 block + DESTRUCTIVE_COMMAND;其余(含 dig/curl/ping/tc/iptables/systemctl、删临时目录)pass。
// 输入:{event:'verify.hostCommand', binding:{...}, subject}
// subject:{command:<string>} — 主机上要执行的 shell 命令行。
// 输出:{decision:'pass'} | {decision:'block', code, facts}
// 只拦真正自毁的形状：删系统根与系统目录、重做文件系统、写裸设备、关机重启、改口令删用户。
// 测试床上的常规命令（dig、curl、ping、tc、systemctl、iptables 规则重置、删 /tmp 或工作目录）必须放行。
const DESTRUCTIVE = [
  /\brm\s+(-[a-zA-Z]+\s+)*(\/|\/\*|~|\$HOME|\/(etc|usr|bin|sbin|lib|lib64|boot|var|home|root|opt|srv)(\/\*)?)(\s|$)/,
  /\bmkfs(\.[a-z0-9]+)?\b/i, /\bdd\s+.*\bof=\/dev\//i, /\bshutdown\b/i, /\breboot\b/i, /\bpoweroff\b/i, /\binit\s+[06]\b/,
  /\bkill\s+-9\s+-1\b/, />\s*\/dev\/(sd|nvme|hd)[a-z0-9]/i, /\bch(own|mod)\s+-R\b.*\s\/\s*$/,
  /\bpasswd\b/, /\buserdel\b/, /\bcrontab\s+-r\b/,
];

export default function handle(input) {
  const subject = input?.subject ?? {};
  const command = typeof subject.command === 'string' ? subject.command : '';
  const matched = DESTRUCTIVE.find((pattern) => pattern.test(command));
  if (matched) return { decision: 'block', code: 'DESTRUCTIVE_COMMAND', facts: { command, pattern: String(matched), event: input?.event ?? null } };
  return { decision: 'pass' };
}
