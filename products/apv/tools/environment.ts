// Tool: 执行环境解释(纯函数,输入结构、输出结构;不读环境、不连网、不写文件)。
// 来源:hub packs/apv/execution/environment.ts @ be9c6c0(行为对照基准)。
// 迁移说明:原版用 node:net 的 isIP,本版内联等价的 IP 校验(禁 node:*);设备映射的
// 取值优先级与可证边界逐条保持:env_prepare.conf.device_ips → bed_topology.
// applies_to.device_ssh_ips → bed_topology.devices(负载均衡 + APVn 命名),任一来源
// 不满足唯一性与数量一致即返回 null(不可证),不做假设。
// imports(hub 依赖集): 无

export interface DeviceAttribution { environment?: any; topology?: any }
export interface DeviceMap { addresses: string[][]; source: string }

// IP 校验:IPv4 点分十进制(0–255 每段)与 IPv6(冒号十六进制,含 :: 压缩与
// 可选末段 IPv4),语义与 node:net 的 isIP 一致——只判形状,不做 DNS。
export function ipVersion(value: string): 0 | 4 | 6 {
  if (typeof value !== 'string' || value.includes('/') || value.includes(' ')) return 0;
  const v4 = value.split('.');
  if (v4.length === 4 && v4.every((part) => /^\d{1,3}$/.test(part) && Number(part) <= 255 && (part.length === 1 || part[0] !== '0'))) return 4;
  if (!value.includes(':')) return 0;
  if ((value.match(/::/g) ?? []).length > 1) return 0;
  const [head, tail = ''] = value.split('::');
  const groups = [...(head ? head.split(':') : []), ...(tail ? tail.split(':') : [])].filter((g) => g !== '');
  if (value.includes('::')) {
    if (head === '' && tail === '') return groups.length === 0 ? 6 : 0; // "::" itself
    if (groups.length >= 8) return 0;
  } else if (groups.length !== 8) return 0;
  for (const group of groups) {
    if (/^[0-9a-fA-F]{1,4}$/.test(group)) continue;
    // trailing IPv4 form (only in the last group)
    if (group === groups[groups.length - 1] && group.includes('.')) {
      return ipVersion(group) === 4 ? 6 : 0;
    }
    return 0;
  }
  return 6;
}

// 地址规范化:IPv6 压缩为小写规范形(括号剥除),IPv4 原样;非 IP 返回 null。
export const deviceAddress = (value: unknown): string | null => {
  if (typeof value !== 'string') return null;
  const bare = value.startsWith('[') && value.endsWith(']') ? value.slice(1, -1) : value;
  const version = ipVersion(bare);
  if (version === 4) return bare;
  if (version === 6) return bare.toLowerCase();
  return null;
};

// 设备映射:三条来源按优先级,全部可证才成立;devices 数组下标即设备序号。
export function environmentDevices(attribution: DeviceAttribution = {}): DeviceMap | null {
  const count = attribution.environment?.device_count;
  const ordered = (values: any, source: string): DeviceMap | null => {
    if (!Array.isArray(values)) return null;
    const ips = values.map(deviceAddress);
    if (!ips.length || ips.some((ip) => !ip) || new Set(ips).size !== ips.length) return null;
    if (Number.isInteger(count) && count !== ips.length) return null;
    return { addresses: ips.map((ip) => [ip!]), source };
  };
  if (attribution.environment?.conf?.device_ips !== undefined)
    return ordered(attribution.environment.conf.device_ips, 'gateway.env_prepare.conf.device_ips');
  if (attribution.topology?.topology?.applies_to?.device_ssh_ips !== undefined)
    return ordered(attribution.topology.topology.applies_to.device_ssh_ips, 'gateway.bed_topology.applies_to.device_ssh_ips');
  const nodes = attribution.topology?.topology?.devices;
  if (!Array.isArray(nodes) || !Number.isInteger(count) || count < 1) return null;
  const loadBalancers = nodes.filter((item: any) => item?.type === '负载均衡');
  if (loadBalancers.length !== count) return null;
  const addresses: string[][] = Array.from({ length: count });
  for (const node of loadBalancers) {
    const name = typeof node.name === 'string' ? /^APV([0-9]+)$/.exec(node.name) : null;
    const index = name ? Number(name[1]) : -1;
    if (index < 0 || index >= count || addresses[index] || !Array.isArray(node.ipv4) || !node.ipv4.length) return null;
    const ips = node.ipv4.map((cidr: any) => {
      if (typeof cidr !== 'string') return null;
      const [ip, prefix, ...rest] = cidr.split('/');
      return ipVersion(ip) === 4 && !rest.length && (prefix === undefined || (/^\d+$/.test(prefix) && Number(prefix) <= 32)) ? ip : null;
    });
    if (ips.some((ip: string | null) => !ip)) return null;
    addresses[index] = [...new Set<string>(ips)];
  }
  if (addresses.some((ips) => !ips?.length)) return null;
  return { addresses, source: 'gateway.bed_topology.devices' };
}

// 构建核对:期望构建与 env_prepare 的 device_build 检查回报逐字比对,可证才 pass。
export function environmentBuild(environment: any, expectedBuild: string) {
  const check = environment?.checks?.find((item: any) => item.check === 'device_build');
  const detail = typeof check?.detail === 'string' ? /^device reports (.+), gateway bundle is (.+)$/.exec(check.detail) : null;
  const observedBuild = typeof environment?.observedBuild === 'string' ? environment.observedBuild : detail?.[1] ?? null;
  return {
    ruleId: 'observed-device-build',
    ruleVersion: '1.0.0',
    observationSource: 'gateway.env_prepare',
    expectedBuild,
    observedBuild,
    passed: environment?.ready === true && environment?.build_checked === true && check?.ok === true && observedBuild === expectedBuild,
  };
}
