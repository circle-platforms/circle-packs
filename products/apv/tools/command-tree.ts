// Tool: 命令树 XML 原件解析(纯函数,输入字节、输出结构;不读环境、不连网、不写文件)。
// 来源:hub packages/connectors/src/build-site.ts commandsFrom + structure.ts xmlTree @ 1c85b1d
// (行为逐字一致:scope/menu 遍历、item 名拼接、arg 属性+子元素+text 合并)。
// 本版不依赖 hub 源码;SaxesParser 来自 hub 依赖集,imports 精确声明 saxes。
// imports(hub 依赖集): saxes@5.0.1
import { SaxesParser } from 'saxes';

export interface XmlNode { name: string; attributes: Record<string, string>; text: string; children: XmlNode[] }
export interface TreeArgument { position?: string; type?: string; optional?: string; min?: string; max?: string; enum?: string; help?: string; [key: string]: unknown }
export interface TreeCommand { name: string; scope: string | null; arguments: TreeArgument[] }

class TreeError extends Error {
  readonly code: string;
  constructor(code: string, message: string) { super(message); this.code = code; }
}
const fail = (code: string, message: string): never => { throw new TreeError(code, message); };

export function xmlTree(bytes: Uint8Array): XmlNode {
  const parser = new SaxesParser({ xmlns: false });
  const root: XmlNode = { name: '#root', attributes: {}, text: '', children: [] };
  const stack = [root];
  parser.on('doctype', () => { fail('INVALID_PAYLOAD', 'XML document types and entities are not supported'); });
  parser.on('error', () => { fail('INVALID_PAYLOAD', 'Source XML is malformed'); });
  parser.on('opentag', (tag: any) => {
    if (stack.length >= 100) fail('INVALID_PAYLOAD', 'XML nesting exceeds the limit');
    const node: XmlNode = { name: String(tag.name).split(':').at(-1)!, attributes: tag.attributes as Record<string, string>, text: '', children: [] };
    stack.at(-1)!.children.push(node);
    stack.push(node);
  });
  parser.on('text', (value: string) => { stack.at(-1)!.text += value; });
  parser.on('cdata', (value: string) => { stack.at(-1)!.text += value; });
  const encoding = Buffer.from(bytes.subarray(0, 300)).toString('ascii').match(/<\?xml\b[^?]*encoding\s*=\s*["']([^"']+)["']/i)?.[1]?.toLowerCase() ?? 'utf-8';
  if (!['utf-8', 'utf8', 'iso-8859-1', 'latin1', 'us-ascii'].includes(encoding)) fail('INVALID_PAYLOAD', 'XML encoding is not supported');
  const decoded = Buffer.from(bytes).toString((['iso-8859-1', 'latin1'] as const).includes(encoding as any) ? 'latin1' : 'utf8');
  parser.on('closetag', () => { stack.pop(); });
  parser.write(decoded).close();
  return root;
}

export const xmlNodes = (node: XmlNode, name: string): XmlNode[] =>
  [...(node.name === name ? [node] : []), ...node.children.flatMap((child) => xmlNodes(child, name))];

// The frozen command-tree XML original → {commands:[{name,scope,arguments}]}, byte-for-byte
// the same walk the hub's BuildSite.commandsFrom performs: scope labels carry, menus join
// into the item name, arguments merge attributes with child-element text.
export function parseCommandTree(bytes: Uint8Array): { commands: TreeCommand[] } {
  const root = xmlTree(bytes);
  const commands: TreeCommand[] = [];
  const label = (node: XmlNode) => node.attributes.name ?? node.children.find((child) => child.name === 'name')?.text.trim() ?? node.text.trim();
  const visit = (node: XmlNode, scope: string | null, menus: string[]) => {
    const nextScope = node.name === 'scope' ? label(node) : scope;
    const nextMenus = node.name === 'scope' ? [] : node.name === 'menu' ? [...menus, label(node)].filter(Boolean) : menus;
    if (node.name === 'item') {
      const name = label(node);
      if (!name) fail('INVALID_PAYLOAD', 'Command item requires a name');
      commands.push({
        name: [...nextMenus, name].join(' ').replace(/\s+/g, ' ').trim(),
        scope: nextScope,
        arguments: xmlNodes(node, 'arg').map((arg) => ({
          ...arg.attributes,
          ...Object.fromEntries(arg.children.filter((child) => child.text.trim()).map((child) => [child.name, child.text.trim()])),
          ...(arg.text.trim() ? { text: arg.text.trim() } : {}),
        })),
      });
    }
    for (const child of node.children) visit(child, nextScope, nextMenus);
  };
  visit(root, null, []);
  return { commands };
}
