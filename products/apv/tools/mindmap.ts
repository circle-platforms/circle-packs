// Tool: mindmap 结构解析与用例清单行展开(纯函数,输入字节、输出结构;不读环境、不连网、不写文件)。
// 来源:server-s2 packs/apv/methods/mindmap.ts @ bd364ac58ac16b8496c5bac39246b8c64c6e0e68
// 迁移说明:原版依赖 server-s2 contracts 包(ApiError/sha256/canonicalHash/MAX_SOURCE_BYTES)
// 与 ExcelJS;本版将错误与哈希内联为本地实现,工作簿的 OOXML 写出由技能包承担,本模块只负责
// 解析与 IR 校验,保持字节输入、结构输出。
// imports(hub 依赖集): fflate@0.8.3
import { unzipSync } from 'fflate';

export interface Topic { title: string; note?: string; children: Topic[] }
export interface UnmappedElement { path: string; reason: string }
export interface ParsedMindmap { ir: Topic; format: string; unmapped: UnmappedElement[]; irSha256: string }
export const CASE_COLUMNS = ['编号', '一级模块', '二级模块', '用例标题', '备注', '层级深度', '路径'];
export const MAX_SOURCE_BYTES = 16 * 1024 * 1024;

export class ModuleError extends Error {
  readonly code: string;
  readonly details: Record<string, unknown>;
  constructor(code: string, message: string, details: Record<string, unknown> = {}) {
    super(message);
    this.code = code;
    this.details = details;
  }
}
const invalid = (message: string): never => { throw new ModuleError('INVALID_MINDMAP', message); };

export async function sha256(bytes: Uint8Array): Promise<string> {
  const { createHash } = await import('node:crypto');
  return createHash('sha256').update(bytes).digest('hex');
}
export async function canonicalHash(value: unknown): Promise<string> {
  const stable = (v: unknown): string => {
    if (v === null || typeof v !== 'object') return JSON.stringify(v);
    if (Array.isArray(v)) return `[${v.map(stable).join(',')}]`;
    const entries = Object.entries(v as Record<string, unknown>).sort(([a], [b]) => (a < b ? -1 : 1));
    return `{${entries.map(([k, val]) => `${JSON.stringify(k)}:${stable(val)}`).join(',')}}`;
  };
  return sha256(new TextEncoder().encode(stable(value)));
}

function object(value: unknown, path: string): Record<string, any> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) invalid(`Expected an object at ${path}`);
  return value as Record<string, any>;
}
function text(value: unknown, path: string, title = false): string {
  if (typeof value !== 'string') invalid(`Expected text at ${path}`);
  const normalized = title ? value.trim().replace(/[\r\n]+/g, ' ') : value;
  if ((title && !normalized) || normalized.length > 32_767 || /[\x00-\x08\x0b\x0c\x0e-\x1f]/.test(normalized))
    invalid(`Invalid spreadsheet text at ${path}`);
  return normalized;
}

export async function parseMindmap(source: Uint8Array, fileName: string): Promise<ParsedMindmap> {
  if (source.byteLength > MAX_SOURCE_BYTES) invalid('Source exceeds the upload limit');
  let bytes = source; let zipped = false; const unmapped: UnmappedElement[] = [];
  const zipMagic = source[0] === 0x50 && source[1] === 0x4b;
  if (zipMagic) {
    zipped = true; let size = 0; let entries = 0; let contentCount = 0;
    let archive: Record<string, Uint8Array>;
    try {
      archive = unzipSync(source, {
        filter: (entry) => {
          entries++; size += entry.originalSize;
          if (entries > 2048 || size > 64 * 1024 * 1024 || entry.name.startsWith('/') || entry.name.includes('\\') || entry.name.split('/').includes('..'))
            invalid('Unsafe or oversized XMind archive');
          if (entry.name === 'content.json') { contentCount++; if (entry.originalSize > MAX_SOURCE_BYTES) invalid('XMind content.json exceeds the limit'); return true; }
          if (!['metadata.json', 'manifest.json', 'Thumbnails/thumbnail.png'].includes(entry.name) && !entry.name.endsWith('/'))
            unmapped.push({ path: `zip:${entry.name}`, reason: 'Archive attachment or extension is not mapped to V1 cells' });
          return false;
        },
      });
      if (contentCount !== 1 || !archive['content.json'])
        throw new ModuleError('UNSUPPORTED_MINDMAP', 'XMind 2020+ requires exactly one root content.json; content.xml is unsupported');
      bytes = archive['content.json'];
      if (bytes.byteLength > MAX_SOURCE_BYTES) invalid('Expanded content exceeds the limit');
    } catch (error) { if (error instanceof ModuleError) throw error; invalid('Cannot parse the XMind zip archive'); }
  } else if (fileName.toLowerCase().endsWith('.xmind')) {
    throw new ModuleError('UNSUPPORTED_MINDMAP', 'A .xmind input must be a zip containing content.json');
  }
  let input: unknown;
  try { input = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes).replace(/^﻿/, '')); }
  catch { invalid('Source is not valid UTF-8 JSON'); }
  const extras = (record: Record<string, unknown>, allowed: string[], path: string) => {
    for (const key of Object.keys(record)) if (!allowed.includes(key))
      unmapped.push({ path: `${path}.${key}`, reason: 'Element is outside the frozen structural mapping' });
  };
  let count = 0;
  const limits = (depth: number) => { count++; if (depth > 128 || count > 50_000) invalid('Mindmap exceeds depth or node limits'); };
  const tree = (value: unknown, path: string, depth: number): Topic => {
    limits(depth); const node = object(value, path); extras(node, ['title', 'note', 'children'], path);
    if (node.children !== undefined && !Array.isArray(node.children)) invalid(`Expected children array at ${path}`);
    return {
      title: text(node.title, `${path}.title`, true),
      ...(node.note === undefined ? {} : { note: text(node.note, `${path}.note`) }),
      children: (node.children ?? []).map((child: unknown, index: number) => tree(child, `${path}.children[${index}]`, depth + 1)),
    };
  };
  const xmind = (value: unknown, path: string, depth: number): Topic => {
    limits(depth); const node = object(value, path); extras(node, ['id', 'class', 'title', 'notes', 'children'], path);
    let note: string | undefined;
    if (node.notes !== undefined) {
      const notes = object(node.notes, `${path}.notes`); extras(notes, ['plain'], `${path}.notes`);
      if (notes.plain !== undefined) {
        const plain = object(notes.plain, `${path}.notes.plain`); extras(plain, ['content'], `${path}.notes.plain`);
        note = text(plain.content, `${path}.notes.plain.content`);
      }
    }
    let children: unknown[] = [];
    if (node.children !== undefined) {
      const group = object(node.children, `${path}.children`); extras(group, ['attached'], `${path}.children`);
      if (group.attached !== undefined && !Array.isArray(group.attached)) invalid(`Expected children.attached array at ${path}`);
      children = group.attached ?? [];
    }
    return {
      title: text(node.title, `${path}.title`, true),
      ...(note === undefined ? {} : { note }),
      children: children.map((child, index) => xmind(child, `${path}.children.attached[${index}]`, depth + 1)),
    };
  };
  let ir: Topic; let format: string;
  if (Array.isArray(input)) {
    if (!input.length) invalid('XMind contains no sheets');
    const sheet = object(input[0], '$[0]'); extras(sheet, ['id', 'class', 'title', 'rootTopic'], '$[0]');
    ir = xmind(sheet.rootTopic, '$[0].rootTopic', 0);
    for (let index = 1; index < input.length; index++)
      unmapped.push({ path: `$[${index}]`, reason: 'Additional XMind sheet is outside V1; only the first sheet is compiled' });
    format = zipped ? 'XMind 2020+ zip / content.json' : 'XMind content.json';
  } else {
    if (zipped) invalid('XMind content.json must be an array of sheets');
    const envelope = object(input, '$');
    if ('root' in envelope) { extras(envelope, ['root', 'formatNote', 'sampleId', 'type'], '$'); ir = tree(envelope.root, '$.root', 0); }
    else ir = tree(envelope, '$', 0);
    format = '主题树 JSON';
  }
  if (JSON.stringify(unmapped).length > 32_767) invalid('Unmapped element report exceeds a V1 explanation cell');
  return { ir, format, unmapped, irSha256: await canonicalHash(ir) };
}
