import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { validateAnswer, loadSection, cite } from '../scripts/cite.mjs';

function workspace(t, { answer = null, sections = [] } = {}) {
  const folder = mkdtempSync(join(tmpdir(), 'qa-'));
  t.after(() => rmSync(folder, { recursive: true, force: true }));
  const args = sections.map((section, i) => {
    const path = join(folder, `section-${i}.json`);
    writeFileSync(path, JSON.stringify({
      tool: 'docs.section',
      args: { file: section.file },
      at: '2026-10-13T00:00:00.000Z',
      response: { result: { file: section.file, anchor: section.anchor, lines: section.lines }, evidence: [{ evidenceId: section.evidenceId, sha256: 'ab'.repeat(32) }] },
    }));
    return path;
  });
  if (answer) writeFileSync(join(folder, 'answer.json'), JSON.stringify(answer));
  return { folder, args };
}

const LINES = ['**sdns listener**', '配置 SDNS 监听器地址。', 'sdns listener <ip> [port]', '不配置 sdns listener 时,sdns 功能不生效。'];
const QUOTE = '不配置 sdns listener 时,sdns 功能不生效。';

test('a verbatim quote with its evidenceId validates and renders [evd_…] tags', (t) => {
  const { folder, args } = workspace(t, {
    answer: {
      question: '不配置 listener 会怎样?',
      status: 'answered',
      answer: `配置 SDNS 监听器地址。\n\n${QUOTE}`,
      citations: [
        { evidenceId: 'evd_s1', source: 'cli/rel_apv_10_5/sdns.md', section: 'sdns listener', quote: '配置 SDNS 监听器地址。' },
        { evidenceId: 'evd_s1', source: 'cli/rel_apv_10_5/sdns.md', section: 'sdns listener', quote: QUOTE },
      ],
    },
    sections: [{ file: 'cli/rel_apv_10_5/sdns.md', anchor: 'sdns listener', lines: LINES, evidenceId: 'evd_s1' }],
  });
  const result = cite(folder, args);
  assert.equal(result.status, 'answered');
  assert.equal(result.citations, 2);
  const md = readFileSync(join(folder, 'answer.md'), 'utf8');
  assert.ok(md.includes(`[evd_s1]`));
  assert.ok(md.includes(QUOTE));
  assert.ok(md.includes('## 引用'));
});

test('a quote that is not in any section return is rejected and no answer.md is written', (t) => {
  const { folder, args } = workspace(t, {
    answer: {
      question: 'q',
      status: 'answered',
      answer: `段落\n\n${QUOTE}`,
      citations: [{ evidenceId: 'evd_s1', source: 'x', section: 'y', quote: QUOTE }],
    },
    sections: [{ file: 'a.md', anchor: 'a', lines: ['完全不同的文字。'], evidenceId: 'evd_s1' }],
  });
  assert.throws(() => cite(folder, args), /not in any section return/);
  assert.equal(existsSync(join(folder, 'answer.md')), false);
});

test('an evidenceId that does not belong to the return the quote was found in is rejected', (t) => {
  const { folder, args } = workspace(t, {
    answer: {
      question: 'q',
      status: 'answered',
      answer: QUOTE,
      citations: [{ evidenceId: 'evd_other', source: 'x', section: 'y', quote: QUOTE }],
    },
    sections: [{ file: 'a.md', anchor: 'a', lines: LINES, evidenceId: 'evd_s1' }],
  });
  assert.throws(() => cite(folder, args), /does not belong/);
  assert.equal(existsSync(join(folder, 'answer.md')), false);
});

test('no_evidence renders the not-found answer and tolerates empty citations', (t) => {
  const { folder, args } = workspace(t, {
    answer: { question: 'q', status: 'no_evidence', answer: '手册里没有找到能回答这个问题的内容。', citations: [] },
    sections: [{ file: 'a.md', anchor: 'a', lines: LINES, evidenceId: 'evd_s1' }],
  });
  const result = cite(folder, args);
  assert.equal(result.status, 'no_evidence');
  const md = readFileSync(join(folder, 'answer.md'), 'utf8');
  assert.ok(md.includes('没有找到'));
  assert.ok(md.includes('不含任何推断'));
});

test('answered without citations, and no_evidence with citations, are both rejected', (t) => {
  const bare = workspace(t, {
    answer: { question: 'q', status: 'answered', answer: 'x', citations: [] },
    sections: [{ file: 'a.md', anchor: 'a', lines: LINES, evidenceId: 'evd_s1' }],
  });
  assert.throws(() => cite(bare.folder, bare.args), /at least one citation/);
  const loaded = workspace(t, {
    answer: { question: 'q', status: 'no_evidence', answer: '没有找到。', citations: [{ evidenceId: 'evd_s1', source: 'x', section: 'y', quote: QUOTE }] },
    sections: [{ file: 'a.md', anchor: 'a', lines: LINES, evidenceId: 'evd_s1' }],
  });
  assert.throws(() => cite(loaded.folder, loaded.args), /no_evidence must carry no citations/);
});

test('a paragraph no citation quote appears in is rejected', (t) => {
  const { folder, args } = workspace(t, {
    answer: {
      question: 'q',
      status: 'answered',
      answer: `这是没有任何引用支撑的一段。\n\n${QUOTE}`,
      citations: [{ evidenceId: 'evd_s1', source: 'x', section: 'y', quote: QUOTE }],
    },
    sections: [{ file: 'a.md', anchor: 'a', lines: LINES, evidenceId: 'evd_s1' }],
  });
  assert.throws(() => cite(folder, args), /carries no citation quote/);
  assert.equal(existsSync(join(folder, 'answer.md')), false);
});

test('a {savedAs} pointer resolves like apv-case-review: as given, workspace root, batch folder', (t) => {
  const folder = mkdtempSync(join(tmpdir(), 'qa-'));
  t.after(() => rmSync(folder, { recursive: true, force: true }));
  mkdirSync(join(folder, 'server-returns'), { recursive: true });
  writeFileSync(join(folder, 'server-returns', 'section.json'), JSON.stringify({
    response: { result: { file: 'a.md', lines: LINES }, evidence: [{ evidenceId: 'evd_ptr' }] },
  }));
  mkdirSync(join(folder, 'checks'), { recursive: true });
  const pointer = join(folder, 'checks', 'ptr.json');
  writeFileSync(pointer, JSON.stringify({ savedAs: 'server-returns/section.json' }));
  const section = loadSection(folder, pointer);
  assert.deepEqual(section.evidenceIds, ['evd_ptr']);
  assert.ok(section.strings.includes(QUOTE));
});
