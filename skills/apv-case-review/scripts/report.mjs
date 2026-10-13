#!/usr/bin/env node
// Step 4: merge structure, command and judgement findings into the review report.
//   node report.mjs <batch folder>
// Reads out/review_structure.json, out/review_commands.json and out/review_findings.json
// (the model's judgement findings), writes out/review_report.json and out/review_report.md.
import { readFileSync, existsSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { createHash } from 'node:crypto';

const sha256 = (bytes) => createHash('sha256').update(bytes).digest('hex');
const readJson = (path) => JSON.parse(readFileSync(path, 'utf8'));

// Model judgement findings use exactly these codes; anything else is a mistake, not a finding.
export const FINDING_CODES = ['coverage_gap', 'expectation_unverifiable', 'risk_dataplane', 'risk_order_dependency', 'cleanup_missing', 'related_defect'];

export function mergeReport(folder) {
  const structure = existsSync(join(folder, 'review_structure.json')) ? readJson(join(folder, 'review_structure.json')) : null;
  const commands = existsSync(join(folder, 'review_commands.json')) ? readJson(join(folder, 'review_commands.json')) : null;
  const findings = existsSync(join(folder, 'review_findings.json')) ? readJson(join(folder, 'review_findings.json')) : { findings: [] };

  const items = [];
  if (structure) {
    for (const [autoid, result] of Object.entries(structure.cases)) {
      for (const violation of result.violations)
        items.push({ origin: 'script', autoid, code: violation.code, summary: violation.detail, facts: { autoid, code: violation.code }, evidenceIds: [] });
    }
  }
  if (commands) {
    for (const entry of commands.commands ?? []) {
      if (entry.status !== 'hit')
        items.push({ origin: 'script', autoid: entry.autoid ?? null, code: entry.status === 'missing' ? 'command_not_in_tree' : 'command_violation', summary: entry.command, facts: entry, evidenceIds: entry.evidenceId ? [entry.evidenceId] : [] });
    }
    for (const entry of commands.clients ?? []) {
      if (entry.status !== 'enabled')
        items.push({ origin: 'script', autoid: entry.autoid ?? null, code: 'client_not_in_contract', summary: entry.client, facts: entry, evidenceIds: [] });
    }
  }
  for (const finding of findings.findings ?? []) {
    const code = finding.code ?? '';
    if (!FINDING_CODES.includes(code)) throw new Error(`review_findings.json: code ${JSON.stringify(code)} is outside ${FINDING_CODES.join(' / ')}`);
    items.push({ origin: finding.origin === 'script' ? 'script' : 'model', autoid: finding.autoid ?? null, code, summary: finding.summary ?? '', facts: finding.facts ?? {}, evidenceIds: finding.evidenceIds ?? [] });
  }

  const report = {
    schema: 'apv.case-review.report',
    folder,
    totals: {
      cases: structure?.case_count ?? null,
      structure_failures: structure?.fail_count ?? null,
      findings: items.length,
      script_findings: items.filter((i) => i.origin === 'script').length,
      model_findings: items.filter((i) => i.origin === 'model').length,
    },
    items,
    note: '评审未在设备上运行任何用例:reviewed 指通过结构与命令核对、判断已记录,不代表用例在设备上通过。',
  };
  const json = JSON.stringify(report, null, 2) + '\n';
  writeFileSync(join(folder, 'review_report.json'), json);
  const md = [
    '# 用例评审报告',
    '',
    `- 用例数:${report.totals.cases ?? '未读取'}`,
    `- 结构失败:${report.totals.structure_failures ?? '未读取'}`,
    `- 发现:${report.totals.findings}(script ${report.totals.script_findings} / model ${report.totals.model_findings})`,
    '',
    ...items.map((i) => `- [${i.origin}] ${i.autoid ?? '-'} ${i.code}:${i.summary}`),
    '',
    report.note,
    '',
  ].join('\n');
  writeFileSync(join(folder, 'review_report.md'), md);
  return { ...report, sha256: sha256(Buffer.from(json)) };
}

if (process.argv[1] && import.meta.url === `file://${process.argv[1]}`) {
  const [folder] = process.argv.slice(2);
  if (!folder) { console.error('usage: node report.mjs <batch folder>'); process.exit(2); }
  const report = mergeReport(folder);
  console.log(JSON.stringify({ findings: report.totals.findings, sha256: report.sha256 }));
}
