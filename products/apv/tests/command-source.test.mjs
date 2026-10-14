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
