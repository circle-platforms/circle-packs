import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { validateAnswer, loadSection, loadReturn, cite, manualLog } from '../scripts/cite.mjs';

function workspace(t, { answer = null, sections = [] } = {}) {
  const folder = mkdtempSync(join(tmpdir(), 'qa-'));
  t.after(() => rmSync(folder, { recursive: true, force: true }));
  const sectionArgs = sections.map((section, i) => {
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
  return { folder, sectionArgs };
}

const LINES = ['**sdns listener**', '配置 SDNS 监听器地址。', 'sdns listener <ip> [port]', '不配置 sdns listener 时,sdns 功能不生效。'];
const QUOTE = '不配置 sdns listener 时,sdns 功能不生效。';
const SECTION = { file: 'cli/rel_apv_10_5/sdns.md', anchor: 'sdns listener', lines: LINES, evidenceId: 'evd_s1' };

test('tagged paragraphs validate; the model section name survives and no saved path is rendered', (t) => {
  const { folder, sectionArgs } = workspace(t, {
    answer: {
      question: '不配置 listener 会怎样?',
      status: 'answered',
      answer: `sdns listener 用来配置监听器地址。 [evd_s1]\n\n具体行为是:${QUOTE} [evd_s1]`,
      citations: [
        { evidenceId: 'evd_s1', source: 'cli/rel_apv_10_5/sdns.md', section: 'sdns listener 小节', quote: '配置 SDNS 监听器地址。' },
        { evidenceId: 'evd_s1', source: 'cli/rel_apv_10_5/sdns.md', section: 'sdns listener 小节', quote: QUOTE },
      ],
    },
    sections: [SECTION],
  });
  const result = cite(folder, sectionArgs);
  assert.equal(result.status, 'answered');
  const md = readFileSync(join(folder, 'answer.md'), 'utf8');
  assert.ok(md.includes('[evd_s1]'));
  assert.ok(md.includes('sdns listener 小节'), 'the model-written section name is rendered');
  assert.ok(!md.includes(sectionArgs[0]), 'the saved return path never appears');
  assert.ok(md.includes('回答为模型判断'));
  assert.ok(md.includes('## 引用'));
});

test('a paragraph without an [evd_…] tag is rejected; a tag pointing at an unvalidated citation is rejected', (t) => {
  const untagged = workspace(t, {
    answer: { question: 'q', status: 'answered', answer: `没有标记的一段。\n\n${QUOTE} [evd_s1]`, citations: [{ evidenceId: 'evd_s1', source: 'x', section: 'y', quote: QUOTE }] },
    sections: [SECTION],
  });
  assert.throws(() => cite(untagged.folder, untagged.sectionArgs), /carries no \[evd_…\] tag/);
  assert.equal(existsSync(join(untagged.folder, 'answer.md')), false);
  const stray = workspace(t, {
    answer: { question: 'q', status: 'answered', answer: `${QUOTE} [evd_ghost]`, citations: [{ evidenceId: 'evd_s1', source: 'x', section: 'y', quote: QUOTE }] },
    sections: [SECTION],
  });
  assert.throws(() => cite(stray.folder, stray.sectionArgs), /not a validated citation/);
});

test('a quote that is not in any section return is rejected and no answer.md is written', (t) => {
  const { folder, sectionArgs } = workspace(t, {
    answer: { question: 'q', status: 'answered', answer: `${QUOTE} [evd_s1]`, citations: [{ evidenceId: 'evd_s1', source: 'x', section: 'y', quote: QUOTE }] },
    sections: [{ ...SECTION, lines: ['完全不同的文字。'] }],
  });
  assert.throws(() => cite(folder, sectionArgs), /not in any section return/);
  assert.equal(existsSync(join(folder, 'answer.md')), false);
});

test('an evidenceId that does not belong to the return the quote was found in is rejected', (t) => {
  const { folder, sectionArgs } = workspace(t, {
    answer: { question: 'q', status: 'answered', answer: `${QUOTE} [evd_other]`, citations: [{ evidenceId: 'evd_other', source: 'x', section: 'y', quote: QUOTE }] },
    sections: [SECTION],
  });
  assert.throws(() => cite(folder, sectionArgs), /does not belong/);
});

test('a quote spanning lines of the section text validates', (t) => {
  const spanning = 'sdns listener <ip> [port]\n不配置 sdns listener 时,sdns 功能不生效。';
  const { folder, sectionArgs } = workspace(t, {
    answer: { question: 'q', status: 'answered', answer: `跨行引用成立。 [evd_s1]`, citations: [{ evidenceId: 'evd_s1', source: 'x', section: 'y', quote: spanning }] },
    sections: [SECTION],
  });
  const result = cite(folder, sectionArgs);
  assert.equal(result.status, 'answered');
  assert.ok(readFileSync(join(folder, 'answer.md'), 'utf8').includes('⏎'));
});

test('identifier keys (file, anchor, evidenceId) are never matched as quote text', (t) => {
  const { folder, sectionArgs } = workspace(t, {
    answer: { question: 'q', status: 'answered', answer: `x [evd_s1]`, citations: [{ evidenceId: 'evd_s1', source: 'x', section: 'y', quote: 'cli/rel_apv_10_5/sdns.md' }] },
    sections: [SECTION],
  });
  assert.throws(() => cite(folder, sectionArgs), /not in any section return/);
});

test('no_evidence renders the not-found answer with the lookup log, misses included', (t) => {
  const folder = mkdtempSync(join(tmpdir(), 'qa-'));
  t.after(() => rmSync(folder, { recursive: true, force: true }));
  const sectionPath = join(folder, 'section.json');
  writeFileSync(sectionPath, JSON.stringify({
    tool: 'docs.section', args: { file: 'cli_cn.md', anchor: 'sdns listener', version: '10.5.0' },
    response: { result: { file: 'cli_cn.md', lines: LINES }, evidence: [{ evidenceId: 'evd_s1' }] },
  }));
  const missPath = join(folder, 'miss.json');
  writeFileSync(missPath, JSON.stringify({
    tool: 'docs.section', args: { file: 'cli_cn.md', anchor: 'quantum something', version: '10.5.0' },
    response: { result: null, error: { code: 'SECTION_ABSENT' } },
  }));
  writeFileSync(join(folder, 'answer.json'), JSON.stringify({ question: 'q', status: 'no_evidence', answer: '手册里没有找到能回答这个问题的内容。', citations: [] }));
  const result = cite(folder, [sectionPath], [sectionPath, missPath]);
  assert.equal(result.status, 'no_evidence');
  const md = readFileSync(join(folder, 'answer.md'), 'utf8');
  assert.ok(md.includes('没有找到'));
  assert.ok(md.includes('## 查询记录'));
  assert.ok(md.includes('anchor "sdns listener" → 命中'));
  assert.ok(md.includes('anchor "quantum something" → 未命中(SECTION_ABSENT)'));
});

test('answered without citations, and no_evidence with citations, are both rejected', (t) => {
  const bare = workspace(t, { answer: { question: 'q', status: 'answered', answer: 'x', citations: [] }, sections: [SECTION] });
  assert.throws(() => cite(bare.folder, bare.sectionArgs), /at least one citation/);
  const loaded = workspace(t, {
    answer: { question: 'q', status: 'no_evidence', answer: '没有找到。', citations: [{ evidenceId: 'evd_s1', source: 'x', section: 'y', quote: QUOTE }] },
    sections: [SECTION],
  });
  assert.throws(() => cite(loaded.folder, loaded.sectionArgs), /no_evidence must carry no citations/);
});

test('a {savedAs} pointer resolves like apv-case-review: as given, workspace root, question folder', (t) => {
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
  assert.ok(section.texts.includes(QUOTE));
  const returns = loadReturn(folder, pointer);
  assert.ok(returns.raw.result);
});

function listReturn(folder, dirs) {
  const path = join(folder, `list-${Math.random().toString(36).slice(2)}.json`);
  writeFileSync(path, JSON.stringify({
    tool: 'docs.list',
    args: { path: '/webdav/cli' },
    at: '2026-10-13T00:00:00.000Z',
    response: { result: { files: dirs.map((d) => ({ path: `/webdav/cli/${d}/`, directory: true })) }, evidence: [{ evidenceId: 'evd_list' }] },
  }));
  return path;
}

test('the manual listing renders into the query log and validates the chosen version', (t) => {
  const folder = mkdtempSync(join(tmpdir(), 'qa-'));
  t.after(() => rmSync(folder, { recursive: true, force: true }));
  const dirs = ['rel_apv_10_4_6', 'rel_apv_10_5_0', 'rel_apv_10_5_1'];
  const log = manualLog(folder, [listReturn(folder, dirs)], '10.5.0');
  assert.deepEqual(log.directories, dirs);
  assert.equal(log.chosen, '10.5.0');
  assert.throws(() => manualLog(folder, [listReturn(folder, dirs)], '10.5'), /no manual directory/);
  assert.throws(() => manualLog(folder, [listReturn(folder, dirs)], ''), /non-empty version/);
});

test('cite renders the manual line before the searches, also on no_evidence', (t) => {
  const folder = mkdtempSync(join(tmpdir(), 'qa-'));
  t.after(() => rmSync(folder, { recursive: true, force: true }));
  const sectionPath = join(folder, 'section.json');
  writeFileSync(sectionPath, JSON.stringify({
    tool: 'docs.section', args: { file: 'cli_cn.md', anchor: 'sdns listener', version: '10.5.0' },
    response: { result: { file: 'cli_cn.md', lines: LINES }, evidence: [{ evidenceId: 'evd_s1' }] },
  }));
  const lookupPath = sectionPath;
  const listPath = listReturn(folder, ['rel_apv_10_4_6', 'rel_apv_10_5_0']);
  writeFileSync(join(folder, 'answer.json'), JSON.stringify({
    question: 'q', status: 'no_evidence', answer: '手册里没有找到能回答这个问题的内容。', citations: [],
  }));
  const result = cite(folder, [sectionPath], [lookupPath], null, [listPath], '10.5.0');
  const md = readFileSync(join(folder, 'answer.md'), 'utf8');
  const manualLine = md.split('\n').find((l) => l.includes('手册目录'));
  const lookupLineIndex = md.split('\n').findIndex((l) => l.includes('anchor "sdns listener"'));
  assert.ok(manualLine.includes('rel_apv_10_5_0'));
  assert.ok(manualLine.includes('选定 10.5.0'));
  assert.ok(manualLine.includes('section 直取'));
  assert.ok(lookupLineIndex > md.split('\n').indexOf(manualLine));
  assert.ok(md.includes('→ 命中'));
  assert.equal(result.status, 'no_evidence');
});
