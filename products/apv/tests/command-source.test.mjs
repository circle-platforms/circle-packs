import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseCommandTree } from '../tools/command-tree.ts';
import { shlex, commandCheck, checkCommands, COMMAND_RULES_VERSION } from '../tools/command-check.ts';
import { createHash } from '../tools/sha256.ts';

// Documentation-range synthetic tree mirroring the hub's menu-path XML shape.
const XML = new TextEncoder().encode(`<?xml version="1.0" encoding="UTF-8"?>
<tree>
  <scope name="configuration">
    <menu name="sdns">
      <item name="on"/>
      <item name="listener">
        <arg type="IPADDR"/>
        <arg type="U16" optional="true"/>
      </item>
      <menu name="zone">
        <menu name="forward">
          <item name="name">
            <arg type="STRING"/>
            <arg type="STRING"/>
            <arg type="STRING" optional="true" enum="default|strict"/>
          </item>
        </menu>
      </menu>
    </menu>
    <item name="service">
      <arg type="STRING"/>
    </item>
  </scope>
  <scope name="enable">
    <item name="health"/>
  </scope>
</tree>`);

test('parseCommandTree walks scopes and menus into flat command names (byte-for-byte hub walk)', () => {
  const { commands } = parseCommandTree(XML);
  const names = commands.map((c) => c.name);
  assert.deepEqual(names, ['sdns on', 'sdns listener', 'sdns zone forward name', 'service', 'health']);
  assert.deepEqual(commands.map((c) => c.scope), ['configuration', 'configuration', 'configuration', 'configuration', 'enable']);
  const listener = commands[1];
  assert.deepEqual(listener.arguments, [{ type: 'IPADDR' }, { type: 'U16', optional: 'true' }]);
});

test('shlex matches the hub tokenizer: quotes, escapes, lowercasing', () => {
  assert.deepEqual(shlex('sdns zone forward name "a b" "c\\"d"'), ['sdns', 'zone', 'forward', 'name', 'a b', 'c"d']);
  assert.throws(() => shlex('x "unterminated'), /unterminated quote/);
  assert.throws(() => shlex('x \\'), /ends with an escape/);
});

test('commandCheck marks hit/missing and argument violations exactly like the hub rules', () => {
  const { commands } = parseCommandTree(XML);
  const checked = commandCheck(commands, [
    'sdns on',
    'sdns listener 192.0.2.10',
    'sdns listener',
    'sdns zone forward name "s.test1" "192.0.2.9%53" default',
    'sdns zone forward name a b c',
    'service inspect alpha',
    'sdns fulldns on',
  ]);
  assert.equal(checked.ruleVersion, COMMAND_RULES_VERSION);
  const by = (command) => checked.commands.find((c) => c.command === command);
  assert.equal(by('sdns on').status, 'hit');
  assert.deepEqual(by('sdns on').violations, []);
  assert.equal(by('sdns listener 192.0.2.10').status, 'hit');
  assert.deepEqual(by('sdns listener 192.0.2.10').violations, []);
  assert.equal(by('sdns listener').status, 'hit');
  assert.deepEqual(by('sdns listener').violations, [{ code: 'ARGUMENT_COUNT', actual: 0, minimum: 1, maximum: 2 }]);
  assert.equal(by('sdns zone forward name "s.test1" "192.0.2.9%53" default').status, 'hit');
  assert.deepEqual(by('sdns zone forward name "s.test1" "192.0.2.9%53" default').violations, []);
  assert.deepEqual(by('sdns zone forward name a b c').violations, [{ code: 'ENUM_MISMATCH', position: 3, allowed: ['default', 'strict'] }]);
  assert.deepEqual(by('service inspect alpha').violations, [{ code: 'ARGUMENT_COUNT', actual: 2, minimum: 1, maximum: 1 }]);
  assert.equal(by('sdns fulldns on').status, 'missing');
  assert.deepEqual(by('sdns fulldns on').violations, [{ code: 'HEAD_MISSING' }]);
});

test('checkCommands wraps the XML original into the sync receipt shape', () => {
  const out = checkCommands(['sdns on', 'sdns listener 10.0.0.999'], { build: 'SYNTHETIC_BUILD_301', buildId: 'bld_1' }, XML);
  assert.equal(out.result.build, 'SYNTHETIC_BUILD_301');
  assert.equal(out.result.buildId, 'bld_1');
  assert.equal(out.result.sourceSha256, createHash(XML));
  assert.equal(out.result.ruleVersion, COMMAND_RULES_VERSION);
  assert.deepEqual(out.evidence, []);
  const bad = out.result.commands[1];
  assert.equal(bad.status, 'hit');
  assert.deepEqual(bad.violations, [{ code: 'TYPE_MISMATCH', position: 1, type: 'IPADDR' }]);
});

test('an ISO-8859-1 declared tree decodes latin1 text (真实树形状)', () => {
  const latin = Buffer.from(`<?xml version="1.0" encoding="ISO-8859-1"?>
<tree><scope name="configuration"><menu name="slb"><item name="virtual"/></menu></scope></tree>`, 'latin1');
  const { commands } = parseCommandTree(latin);
  assert.deepEqual(commands.map((c) => c.name), ['slb virtual']);
});

test('a DOCTYPE declaration is refused', () => {
  const xml = new TextEncoder().encode('<?xml version="1.0"?><!DOCTYPE tree><tree><item name="x"/></tree>');
  assert.throws(() => parseCommandTree(xml), /document types and entities/);
});

test('two menu levels compose the command name in order', () => {
  const xml = new TextEncoder().encode('<?xml version="1.0"?><tree><menu name="slb"><menu name="virtual"><item name="http"/></menu></menu></tree>');
  const { commands } = parseCommandTree(xml);
  assert.deepEqual(commands.map((c) => c.name), ['slb virtual http']);
});

test('quoted arguments keep their spacing through the check', () => {
  const { commands } = parseCommandTree(XML);
  const checked = commandCheck(commands, ['sdns zone forward name "a b" "192.0.2.9%53"']);
  const entry = checked.commands[0];
  assert.equal(entry.status, 'hit');
  assert.deepEqual(entry.arguments, ['a b', '192.0.2.9%53']); // one quoted token stays one argument
  assert.deepEqual(entry.violations, []); // two required args supplied, optional third absent
});

test('two signatures of the same head (overload) pick the matching arity', () => {
  const xml = new TextEncoder().encode('<?xml version="1.0"?><tree><scope name="configuration"><menu name="sdns"><item name="listener"><arg type="IPADDR"/></item><item name="listener"><arg type="IPADDR"/><arg type="U16"/></item></menu></scope></tree>');
  const { commands } = parseCommandTree(xml);
  const checked = commandCheck(commands, ['sdns listener 192.0.2.10 53']);
  const entry = checked.commands[0];
  assert.equal(entry.status, 'hit');
  assert.deepEqual(entry.violations, []);
  assert.ok(entry.matchedSignatures.length === 1);
});

test('an eight-word head matches; a nine-word tree head is refused (hub word limit)', () => {
  const words8 = ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h'];
  const xml = new TextEncoder().encode(`<?xml version="1.0"?><tree><item name="${words8.join(' ')}"/></tree>`);
  const { commands } = parseCommandTree(xml);
  const checked = commandCheck(commands, [words8.join(' ')]);
  assert.equal(checked.commands[0].status, 'hit');
  assert.equal(checked.commands[0].head, words8.join(' '));
  const nine = new TextEncoder().encode('<?xml version="1.0"?><tree><item name="a b c d e f g h i"/></tree>');
  assert.throws(() => commandCheck(parseCommandTree(nine).commands, ['a b c d e f g h i']), /one to eight words/);
});

test('U16/U32 bounds and OUT_OF_RANGE deduplication match the hub', () => {
  const xml = new TextEncoder().encode(`<?xml version="1.0"?><tree>
    <item name="port"><arg type="U16"/><arg type="U32" min="5" max="10"/></item>
  </tree>`);
  const { commands } = parseCommandTree(xml);
  const checked = commandCheck(commands, [
    'port 65535 5',
    'port 65536 65536',   // U16 out of its own range; U32 out of the declared min/max — one violation each
    'port 99999 7',       // U16 beyond both its type range AND any declared range — deduped to one
    'port 70000 4294967295',
  ]);
  const by = (input) => checked.commands.find((c) => c.command === input);
  assert.deepEqual(by('port 65535 5').violations, []);
  assert.deepEqual(by('port 65536 65536').violations, [
    { code: 'OUT_OF_RANGE', position: 1, minimum: 0, maximum: 65535 },
    { code: 'OUT_OF_RANGE', position: 2, minimum: 5, maximum: 10 },
  ]);
  assert.deepEqual(by('port 99999 7').violations, [{ code: 'OUT_OF_RANGE', position: 1, minimum: 0, maximum: 65535 }]);
  assert.deepEqual(by('port 70000 4294967295').violations, [
    { code: 'OUT_OF_RANGE', position: 1, minimum: 0, maximum: 65535 },
    { code: 'OUT_OF_RANGE', position: 2, minimum: 5, maximum: 10 }, // beyond the declared range
  ]);
});

test('an unsupported parameter type reports UNSUPPORTED_PARAMETER_TYPE without TYPE_MISMATCH', () => {
  const xml = new TextEncoder().encode('<?xml version="1.0"?><tree><item name="flag"><arg type="BOOL"/></item></tree>');
  const { commands } = parseCommandTree(xml);
  const checked = commandCheck(commands, ['flag on']);
  assert.deepEqual(checked.commands[0].violations, [{ code: 'UNSUPPORTED_PARAMETER_TYPE', position: 1, type: 'BOOL' }]);
});

test('an unterminated quote reports TOKENIZE_ERROR as missing', () => {
  const { commands } = parseCommandTree(XML);
  const checked = commandCheck(commands, ['sdns zone forward "oops']);
  assert.equal(checked.commands[0].status, 'missing');
  assert.deepEqual(checked.commands[0].violations, [{ code: 'TOKENIZE_ERROR' }]);
});

test('the IPv6 zone id rule matches node:net exactly', () => {
  const xml = new TextEncoder().encode('<?xml version="1.0"?><tree><item name="addr"><arg type="IPADDR"/></item></tree>');
  const { commands } = parseCommandTree(xml);
  const checked = commandCheck(commands, ['addr fe80::1%eth0', 'addr fe80::1%eth_0', 'addr fe80::1%']);
  const by = (input) => checked.commands.find((c) => c.command === input);
  assert.deepEqual(by('addr fe80::1%eth0').violations, []);
  assert.deepEqual(by('addr fe80::1%eth_0').violations, [{ code: 'TYPE_MISMATCH', position: 1, type: 'IPADDR' }]);
  assert.deepEqual(by('addr fe80::1%').violations, [{ code: 'TYPE_MISMATCH', position: 1, type: 'IPADDR' }]);
});

test('a tree with no recognized items is refused like the hub tool packaging', () => {
  const xml = new TextEncoder().encode('<?xml version="1.0"?><tree><menu name="empty"/></tree>');
  assert.throws(() => checkCommands([], { build: 'B', buildId: 'B' }, xml), /no recognized items/);
});

test('overload signatures pick the closest exactly like the hub (canonical ids)', () => {
  const xml = new TextEncoder().encode('<?xml version="1.0"?><tree><scope name="configuration"><item name="ip"><menu name="route"><item name="one"><arg type="IPADDR"/></item><item name="two"><arg type="U16"/></item></menu></item></scope></tree>');
  // simpler flat overload set: same head, two signatures
  const tree = [
    { name: 'ip route', scope: 'configuration', arguments: [{ type: 'IPADDR' }] },
    { name: 'ip route', scope: 'configuration', arguments: [{ type: 'U16' }] },
  ];
  const checked = commandCheck(tree, ['ip route foo']);
  assert.equal(checked.commands[0].status, 'hit');
  assert.deepEqual(checked.commands[0].violations, [{ code: 'TYPE_MISMATCH', position: 1, type: 'IPADDR' }]);
  assert.ok(checked.commands[0].signatureChecks.every((s) => s.signatureId.startsWith('sig_') && s.signatureId.length === 68));
});
