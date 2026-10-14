// Tool: 确定性命令核对(纯函数,输入结构、输出结构;不读环境、不连网、不写文件)。
// 来源:hub packages/methods/src/command-tree.ts @ 1c85b1d(shlex/normalized/match/
// parameters/signatures/commandCheck/checkArguments 逐字一致;isIP 换成内联等价实现,
// canonicalHash 换成内联稳定哈希——语义同构,签名 id 因此与 hub 数值不同属预期,
// present 判定只依赖 status/violations,不受影响)。
// imports(hub 依赖集): 无
import { ipVersion } from './environment.ts';
import type { TreeCommand, TreeArgument } from './command-tree.ts';

export const COMMAND_RULES_VERSION = 'command-tree/1.1.0';
type Command = { name: string; scope?: string | null; arguments: TreeArgument[] };

const isIP = (value: string) => ipVersion(value);

class CheckError extends Error {
  readonly code: string;
  constructor(code: string, message: string) { super(message); this.code = code; }
}
const requireCondition = (ok: unknown, code: string, message: string) => { if (!ok) throw new CheckError(code, message); };

const stableHash = (value: unknown): string => {
  const text = JSON.stringify(value);
  let h1 = 0x811c9dc5, h2 = 0x01000193;
  for (let i = 0; i < text.length; i++) {
    h1 = (h1 ^ text.charCodeAt(i)) >>> 0;
    h1 = Math.imul(h1, 16777619) >>> 0;
    h2 = (h2 + text.charCodeAt(i) * (i + 7)) >>> 0;
  }
  return `sig_${h1.toString(16).padStart(8, '0')}${h2.toString(16).padStart(8, '0')}`;
};

export function shlex(input: string): string[] {
  const tokens: string[] = [];
  let word = '', started = false, quote: string | null = null;
  for (let i = 0; i < input.length; i++) {
    const character = input[i];
    if (character === '\\' && quote !== "'") {
      requireCondition(i + 1 < input.length, 'INVALID_PAYLOAD', 'Command ends with an escape');
      const next = input[++i];
      if (quote === '"' && !['"', '\\'].includes(next)) word += '\\';
      word += next; started = true; continue;
    }
    if (quote) { if (character === quote) quote = null; else word += character; continue; }
    if (character === '"' || character === "'") { quote = character; started = true; continue; }
    if (/\s/.test(character)) { if (started) { tokens.push(word.toLowerCase()); word = ''; started = false; } continue; }
    word += character; started = true;
  }
  requireCondition(!quote, 'INVALID_PAYLOAD', 'Command has an unterminated quote');
  if (started) tokens.push(word.toLowerCase());
  return tokens;
}

function normalized(commands: Command[]): Map<string, Command[]> {
  const heads = new Map<string, Command[]>();
  for (const command of commands) {
    const tokens = shlex(command.name);
    requireCondition(tokens.length > 0 && tokens.length <= 8, 'INVALID_PAYLOAD', 'Command heads contain one to eight words');
    const head = tokens.join(' ');
    const overloads = heads.get(head) ?? [];
    overloads.push(command);
    heads.set(head, overloads);
  }
  return heads;
}

function match(heads: Map<string, Command[]>, tokens: string[]): { head: string; commands: Command[]; length: number } | null {
  for (let length = Math.min(tokens.length, 8); length > 0; length--) {
    const head = tokens.slice(0, length).join(' ');
    const commands = heads.get(head);
    if (commands) return { head, commands, length };
  }
  return null;
}

function parameters(command: Command): any[] {
  return command.arguments.map((arg: any, index: number) => {
    const position = arg.position === undefined ? index + 1 : Number(arg.position);
    requireCondition(Number.isInteger(position) && position >= 1, 'INVALID_PAYLOAD', 'Parameter position is malformed');
    const min = arg.min === undefined ? null : Number(arg.min), max = arg.max === undefined ? null : Number(arg.max);
    requireCondition((min === null || Number.isFinite(min)) && (max === null || Number.isFinite(max)) && (min === null || max === null || min <= max), 'INVALID_PAYLOAD', 'Parameter range is malformed');
    return {
      position,
      type: String(arg.type ?? 'UNKNOWN').toUpperCase(),
      optional: ['true', '1', 'yes'].includes(String(arg.optional ?? 'false').toLowerCase()),
      help: arg.help ?? '',
      range: { min, max },
      enum: arg.enum ? String(arg.enum).split('|').map((value: string) => value.toLowerCase()) : [],
    };
  }).sort((a, b) => a.position - b.position);
}

function signatures(commands: Command[]): any[] {
  const unique = new Map<string, any>();
  for (const command of commands) {
    const scope = command.scope ?? null;
    const params = parameters(command);
    const signatureId = `sig_${stableHash({ scope, parameters: params })}`;
    unique.set(signatureId, { signatureId, scope, parameters: params });
  }
  return [...unique.values()].sort((a, b) => a.parameters.length - b.parameters.length || a.signatureId.localeCompare(b.signatureId));
}

function dottedMask(value: string): boolean {
  if (isIP(value) !== 4) return false;
  const bits = value.split('.').map((part) => Number(part).toString(2).padStart(8, '0')).join('');
  return /^1*0*$/.test(bits);
}

function checkArguments(params: any[], args: string[]): any[] {
  const violations: any[] = [];
  const expected = params.filter((p) => !p.optional).length;
  if (args.length < expected || args.length > params.length || params.some((p) => !p.optional && args[p.position - 1] === undefined))
    violations.push({ code: 'ARGUMENT_COUNT', actual: args.length, minimum: expected, maximum: params.length });
  for (const parameter of params) {
    const value = args[parameter.position - 1];
    if (value === undefined) continue;
    let valid = true, numeric: number | null = null;
    switch (parameter.type) {
      case 'STRING': case 'XSTRING': valid = value.length > 0; break;
      case 'U16': case 'U32': {
        valid = /^[+-]?\d+$/.test(value);
        if (valid) {
          numeric = Number(value);
          const max = parameter.type === 'U16' ? 65535 : 4294967295;
          if (!Number.isSafeInteger(numeric) || numeric < 0 || numeric > max)
            violations.push({ code: 'OUT_OF_RANGE', position: parameter.position, minimum: 0, maximum: max });
        }
        break;
      }
      case 'IPADDR': valid = isIP(value) > 0; break;
      case 'DOTTEDIP': valid = isIP(value) === 4; break;
      case 'IPMASK': valid = dottedMask(value); break;
      default: violations.push({ code: 'UNSUPPORTED_PARAMETER_TYPE', position: parameter.position, type: parameter.type }); continue;
    }
    if (!valid) { violations.push({ code: 'TYPE_MISMATCH', position: parameter.position, type: parameter.type }); continue; }
    if (parameter.enum.length && !parameter.enum.includes(value))
      violations.push({ code: 'ENUM_MISMATCH', position: parameter.position, allowed: parameter.enum });
    if (numeric !== null && (parameter.range.min !== null && numeric < parameter.range.min || parameter.range.max !== null && numeric > parameter.range.max) && !violations.some((v) => v.code === 'OUT_OF_RANGE' && v.position === parameter.position))
      violations.push({ code: 'OUT_OF_RANGE', position: parameter.position, minimum: parameter.range.min, maximum: parameter.range.max });
  }
  return violations;
}

export function commandCheck(commands: Command[], inputs: string[]): any {
  const heads = normalized(commands);
  return {
    ruleVersion: COMMAND_RULES_VERSION,
    commands: inputs.map((input) => {
      let tokens: string[];
      try { tokens = shlex(input); } catch { return { command: input, status: 'missing', head: null, violations: [{ code: 'TOKENIZE_ERROR' }] }; }
      const found = match(heads, tokens);
      if (!found) return { command: input, status: 'missing', head: null, violations: [{ code: 'HEAD_MISSING' }] };
      const args = tokens.slice(found.length);
      const alternatives = signatures(found.commands);
      const checks = alternatives.map((signature) => ({ signatureId: signature.signatureId, scope: signature.scope, violations: checkArguments(signature.parameters, args) }));
      const matched = checks.filter((check) => !check.violations.length);
      const closest = [...checks].sort((a, b) => a.violations.length - b.violations.length || a.signatureId.localeCompare(b.signatureId))[0];
      return { command: input, status: 'hit', head: found.head, arguments: args, violations: matched.length ? [] : closest.violations, matchedSignatures: matched.map((check) => ({ signatureId: check.signatureId, scope: check.scope })), signatureChecks: checks };
    }),
  };
}

// The frozen-XML entry point the flow drives: parse the tree original once (command-tree
// tool), check the workbook's device commands against it, and wrap in the sync tool's
// receipt shape — sourceSha256 is the SHA-256 of the XML original bytes, computed with
// the dependency-free implementation.
import { createHash } from './sha256.ts';
import { parseCommandTree } from './command-tree.ts';
export function checkCommands(treeBytes: Uint8Array, commands: string[], identity: { build: string; buildId: string }) {
  const { commands: tree } = parseCommandTree(treeBytes);
  const checked = commandCheck(tree as Command[], commands);
  // The verify-gate heads derive from the SAME rule both paths share: a command is
  // present when its check is hit with no violations. The receipt keeps only the
  // fields the gates need (command/status/head/violations) — signature detail would
  // blow up the frame on a full workbook.
  const slim = checked.commands.map((entry: any) => ({ command: entry.command, status: entry.status, head: entry.head, violations: entry.violations }));
  return {
    heads: presentHeads(slim),
    result: { build: identity.build, buildId: identity.buildId, sourceSha256: createHash(treeBytes), ruleVersion: checked.ruleVersion, commands: slim },
    evidence: [],
  };
}

// One present rule for both command-source shapes: hit and violation-free.
export function presentHeads(entries: { command: string; status: string; violations: any[] }[]) {
  return entries.map((entry) => ({ command: entry.command, present: entry.status === 'hit' && !(entry.violations ?? []).length }));
}
