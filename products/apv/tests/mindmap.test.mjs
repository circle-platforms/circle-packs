import { test } from 'node:test';
import assert from 'node:assert/strict';
import { zipSync, strToU8 } from 'fflate';
import { parseMindmap, canonicalHash, ModuleError } from '../tools/mindmap.ts';

const enc = (s) => new TextEncoder().encode(s);

test('parses a topic-tree JSON envelope', async () => {
  const source = enc(JSON.stringify({ root: { title: 'root', children: [{ title: 'mod', children: [{ title: 'case a', note: 'n1' }] }] } }));
  const parsed = await parseMindmap(source, 'mindmap.json');
  assert.equal(parsed.format, '主题树 JSON');
  assert.equal(parsed.ir.children[0].children[0].title, 'case a');
  assert.equal(parsed.ir.children[0].children[0].note, 'n1');
  assert.deepEqual(parsed.unmapped, []);
  assert.equal(typeof parsed.irSha256, 'string');
});

test('parses an XMind zip content.json and reports attachments as unmapped', async () => {
  const content = JSON.stringify([{ rootTopic: { title: 'root', children: { attached: [{ title: 'm', children: { attached: [{ title: 'c1' }] } }] } } }]);
  const archive = zipSync({ 'content.json': enc(content), 'Thumbnails/thumbnail.png': enc('png'), 'attachments/x.bin': enc('x') });
  const parsed = await parseMindmap(archive, 'map.xmind');
  assert.equal(parsed.format, 'XMind 2020+ zip / content.json');
  assert.equal(parsed.ir.children[0].children[0].title, 'c1');
  assert.ok(parsed.unmapped.some((u) => u.path === 'zip:attachments/x.bin'));
});

test('rejects an .xmind that is not a zip', async () => {
  await assert.rejects(() => parseMindmap(enc('{"root":{}}'), 'map.xmind'), (e) => e instanceof ModuleError && e.code === 'UNSUPPORTED_MINDMAP');
});

test('canonicalHash is key-order independent', async () => {
  assert.equal(await canonicalHash({ b: 1, a: [true, null] }), await canonicalHash({ a: [true, null], b: 1 }));
});
