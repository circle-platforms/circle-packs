// Bed facts: the authoritative network topology the gate checks every case against.
// The source is the hub's gateway.topology evidence file, saved verbatim
// (bed-facts/<knr_id>.json; it carries real addresses and never enters Git).
// Shape: topology.devices[{name, type(负载均衡|路由器|客户端|服务器|控制台), ipv4[cidr], ipv6[cidr]}]
// plus services[{host, ip, proto, port}].
//
// Derived facts (all mechanical):
//   reachable subnets — every device CIDR
//   device addresses  — per device, the interface addresses it carries
//   trigger hosts     — routers and clients (they originate dig/curl)
//   load balancers    — the APV devices
//   listener list (★) — LB interface addresses whose subnet holds a trigger host
//   pairing           — listener ip → same-subnet trigger host names, lowercased
//   blind addresses   — LB addresses whose subnet has no trigger host
//   server addresses  — addresses carried by 服务器 devices
// Missing file or empty devices is bed_facts_unavailable: the gate refuses the whole
// batch rather than folding the check into a pass.

// --- minimal IP/CIDR arithmetic (IPv4 + IPv6, BigInt for v6) ---
const v4ToBig = (text) => {
  const parts = text.split('.');
  if (parts.length !== 4 || parts.some((p) => !/^\d{1,3}$/.test(p) || Number(p) > 255)) return null;
  return parts.reduce((n, p) => (n << 8n) + BigInt(Number(p)), 0n);
};
const bigToV4 = (big) => [24n, 16n, 8n, 0n].map((s) => Number((big >> s) & 255n)).join('.');
const expandV6 = (text) => {
  let [head, tail = ''] = text.split('::');
  const headGroups = head ? head.split(':').filter(Boolean) : [];
  const tailGroups = tail ? tail.split(':').filter(Boolean) : [];
  const missing = 8 - headGroups.length - tailGroups.length;
  if (missing < 0 || (!text.includes('::') && headGroups.length + tailGroups.length !== 8)) return null;
  const groups = [...headGroups, ...Array(text.includes('::') ? missing : 0).fill('0'), ...tailGroups];
  if (groups.length !== 8) return null;
  let big = 0n;
  for (const g of groups) {
    if (!/^[0-9a-fA-F]{1,4}$/.test(g)) return null;
    big = (big << 16n) + BigInt(parseInt(g, 16));
  }
  return big;
};
const bigToV6 = (big) => {
  const groups = [];
  for (let i = 7; i >= 0; i--) groups.push(((big >> BigInt(i * 16)) & 0xffffn).toString(16));
  const full = groups.join(':');
  // longest run of zero groups compresses to ::
  let best = full;
  let i = 0;
  while (i < 8) {
    if (groups[i] !== '0') { i++; continue; }
    let j = i;
    while (j < 8 && groups[j] === '0') j++;
    if (j - i >= 2) {
      const candidate = groups.slice(0, i).join(':') + '::' + groups.slice(j).join(':');
      if (candidate.length < best.length) best = candidate;
    }
    i = j;
  }
  return best;
};
export const parseIp = (text) => {
  const raw = String(text).trim().replace(/^\[|\]$/g, '');
  if (raw.includes(':')) {
    const big = expandV6(raw.split('%')[0]);
    return big === null ? null : { family: 6, big, text: bigToV6(big) };
  }
  const big = v4ToBig(raw);
  return big === null ? null : { family: 4, big, text: bigToV4(big) };
};
const parseCidr = (text) => {
  const [addr, lenRaw] = String(text).split('/');
  const ip = parseIp(addr);
  if (!ip) return null;
  const bits = ip.family === 4 ? 32 : 128;
  const len = lenRaw === undefined ? bits : Number(lenRaw);
  if (!Number.isInteger(len) || len < 0 || len > bits) return null;
  const hostBits = BigInt(bits - len);
  const mask = len === 0 ? 0n : ((1n << BigInt(len)) - 1n) << hostBits;
  return { family: ip.family, network: ip.big & mask, mask, len, bits };
};
const inCidr = (ip, cidr) => ip.family === cidr.family && (ip.big & cidr.mask) === cidr.network;

// --- literals ---
export const IPV4_RE = /\b\d{1,3}(?:\.\d{1,3}){3}\b/g;
export const IPV6_RE = /\b(?:[0-9a-fA-F]{0,4}:){2,7}[0-9a-fA-F]{0,4}\b/g; // must contain a double colon or ≥2 colons; filtered below
export function literalsOf(command) {
  const out = [];
  for (const match of command.matchAll(IPV4_RE)) {
    if (parseIp(match[0])) out.push(match[0]);
  }
  for (const match of command.matchAll(IPV6_RE)) {
    const candidate = match[0];
    if (!candidate.includes(':') || /^\d+$/.test(candidate)) continue; // time values etc.
    if (!candidate.includes('::') && (candidate.match(/:/g) || []).length < 2) continue;
    if (parseIp(candidate)) out.push(candidate.toLowerCase());
  }
  return out;
}

const TRIGGER_TYPES = new Set(['路由器', '客户端']);
export const normalizeHost = (name) => String(name).trim().replace(/^APV_?/i, 'APV').toLowerCase();
const sameDevice = (workbookHost, deviceName) => normalizeHost(workbookHost) === normalizeHost(deviceName);

export function loadBedFacts(path, { readFileSync }) {
  let parsed;
  try { parsed = JSON.parse(readFileSync(path, 'utf8')); }
  catch { return { ok: false, reason: 'unreadable' }; }
  const devices = parsed?.topology?.devices ?? parsed?.devices;
  if (!Array.isArray(devices) || devices.length === 0) return { ok: false, reason: 'no devices' };
  return { ok: true, file: parsed, devices, services: parsed?.services ?? parsed?.topology?.services ?? [] };
}

export function deriveFacts(file) {
  const deviceRows = file?.devices ?? file?.topology?.devices ?? [];
  const subnets = [];
  const devices = new Map(); // normalized name → {name, type, addresses:[{ip, cidr}]}
  for (const device of deviceRows) {
    const name = String(device.name ?? '').trim();
    if (!name) continue;
    const addresses = [];
    for (const cidrText of [...(device.ipv4 ?? []), ...(device.ipv6 ?? [])]) {
      const cidr = parseCidr(cidrText);
      const ip = parseIp(String(cidrText).split('/')[0]);
      if (!cidr || !ip) continue;
      subnets.push(cidr);
      addresses.push({ ip, cidr, cidrText: String(cidrText) });
    }
    devices.set(normalizeHost(name), { name, type: String(device.type ?? ''), addresses });
  }
  const entries = [...devices.values()];
  const triggers = entries.filter((d) => TRIGGER_TYPES.has(d.type));
  const loadBalancers = entries.filter((d) => d.type === '负载均衡');
  const servers = entries.filter((d) => d.type === '服务器');
  const triggerAddresses = triggers.flatMap((d) => d.addresses.map((a) => ({ host: d.name, ...a })));
  // ★ listener list: LB addresses whose subnet holds a trigger host; pairing per listener.
  const listenerList = [];
  const pairing = new Map();
  const blind = [];
  for (const lb of loadBalancers) {
    for (const address of lb.addresses) {
      const paired = triggerAddresses.filter((t) => inCidr(t.ip, address.cidr)).map((t) => t.host.toLowerCase());
      if (paired.length) {
        listenerList.push(address.ip.text);
        pairing.set(address.ip.text, paired);
      } else {
        blind.push({ device: lb.name, address: address.ip.text });
      }
    }
  }
  const serverAddresses = servers.flatMap((d) => d.addresses.map((a) => a.ip.text));
  return {
    subnets,
    devices,
    triggerHosts: [...new Set(triggers.map((d) => d.name.toLowerCase()))],
    loadBalancers: loadBalancers.map((d) => d.name),
    listenerList,
    pairing,
    blind,
    serverAddresses,
    reachable: (literal) => {
      const ip = parseIp(literal);
      return ip !== null && subnets.some((cidr) => inCidr(ip, cidr));
    },
    carriedBy: (literal, host) => {
      const ip = parseIp(literal);
      if (ip === null) return false;
      for (const device of devices.values()) {
        if (!sameDevice(host, device.name)) continue;
        return device.addresses.some((a) => a.ip.big === ip.big);
      }
      return false;
    },
    deviceAddressInSubnetOf: (literal, host) => {
      const target = parseIp(literal);
      if (target === null) return [];
      for (const device of devices.values()) {
        if (!sameDevice(host, device.name)) continue;
        const inSubnet = device.addresses.filter((a) => a.ip.family === target.family && inCidr(target, a.cidr)).map((a) => a.ip.text);
        return inSubnet;
      }
      return [];
    },
  };
}

// --- per-case mechanical checks (a–f) ---
// Returns {violations, proposals}. violations carry severity 'block'|'warn' and, for the
// author-verbatim disclosure rule, category 'environment'.
const LISTENER_RE = /^sdns\s+listener\s+(\S+)/;
const SLB_VIRTUAL_RE = /^slb\s+virtual\s+\S+\s+"[^"]*"\s+(\S+)/;
const DIG_TARGET_RE = /(?:dig\s+(?:[^@]*\s)?@|\bcurl\s+(?:-\S+\s+)*)([^\s,;]+)/;
const BACKEND_RE = /\b(?:record\s+ip|real|pool)\b/;

export function checkCase(item, facts, sourceText) {
  const violations = [];
  const proposals = [];
  const flag = (row) => violations.push(row);
  const host = (block) => String(block?.host ?? 'APV_0');
  const commands = [];
  for (const command of item.init_commands ?? []) commands.push({ host: 'APV_0', command: String(command) });
  const listeners = [];
  for (const block of item.blocks ?? []) {
    if (block?.kind === 'CONFIG') {
      for (const command of block.cmds ?? []) commands.push({ host: host(block), command: String(command) });
    } else if (block?.kind === 'OBSERVE_ASSERT' && typeof block.cmd === 'string') {
      commands.push({ host: host(block), command: block.cmd });
    } else if (block?.kind === 'CLIENT' && typeof block.cmd === 'string') {
      commands.push({ host: 'test_env', command: block.cmd, client: String(block.client ?? '').toLowerCase() });
    }
  }
  for (const { host: at, command } of commands) {
    for (const literal of literalsOf(command)) {
      if (facts.reachable(literal)) continue;
      const author = sourceText.includes(literal);
      flag(author
        ? { code: 'environment_disclosure', severity: 'block', category: 'environment', literal, command, detail: '作者原文的地址不在本床任何可达子网' }
        : { code: 'address_not_on_bed', severity: 'block', category: 'error', literal, command, detail: '地址不在本床任何可达子网' });
    }
  }
  for (const { host: at, command } of commands) {
    if (at === 'test_env') continue;
    for (const re of [LISTENER_RE, SLB_VIRTUAL_RE]) {
      const literal = re.exec(command)?.[1];
      if (!literal || !parseIp(literal)) continue;
      listeners.push(literal);
      if (facts.carriedBy(literal, at)) continue;
      const inSubnet = facts.deviceAddressInSubnetOf(literal, at);
      const to = inSubnet.length === 1 ? inSubnet[0] : null;
      flag({ code: 'listener_not_on_device', severity: 'block', category: 'error', literal, command, device: at, detail: `${at} 不承载 ${literal}`, ...(to ? { suggestion: to } : {}) });
      if (to) proposals.push({ autoid: item.autoid, rule: 'listener_not_on_device', from: literal, to });
    }
  }
  for (const { command, client } of commands) {
    if (client === undefined) continue;
    const target = DIG_TARGET_RE.exec(command)?.[1];
    if (!target || !parseIp(target)) continue;
    if (!listeners.includes(target) || !facts.listenerList.includes(target))
      flag({ code: 'query_target_not_listener', severity: 'block', category: 'error', literal: target, command, detail: '查询目标不是本例已配置且在监听名单里的地址' });
    else {
      const paired = facts.pairing.get(target) ?? [];
      if (!paired.includes(client))
        flag({ code: 'trigger_host_not_paired_with_target', severity: 'block', category: 'error', literal: target, command, host: client, pairedHosts: paired, detail: `发起主机 ${client} 不在目标 ${target} 的同段触发机里` });
    }
  }
  for (const { command } of commands) {
    if (!BACKEND_RE.test(command)) continue;
    for (const literal of literalsOf(command)) {
      if (facts.serverAddresses.includes(literal)) continue;
      flag({ code: 'backend_not_server', severity: 'warn', category: 'warn', literal, command, detail: '后端地址不是服务器承载地址(警告,不阻断)' });
    }
  }
  const seen = new Set();
  const uniqueProposals = proposals.filter((p) => {
    const key = `${p.autoid}:${p.from}:${p.to}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
  return { violations, proposals: uniqueProposals };
}
