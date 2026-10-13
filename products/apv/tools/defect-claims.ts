// Tool: 禅道缺陷记录 → 候选声明抽取(纯函数,输入结构、输出结构;不读环境、不连网、不写文件)。
// 来源:zentao.bug_detail 的 hub 返回(result 部分),形状以 2026-10-12 落盘的实际返回为准:
// result.items[] 携带 id/state/title/actions[]/product/priority{code,label}/severity{code,label}/
// resolution{raw,mapped}/openedBuild/resolvedBuild/legacyIssueId/…;actions[] 的 action 有
// opened/commented/assigned/svncommited/resolved/edited/linked2bug/closed,evidence id 为 knr_ 前缀。
// 只做字段到谓词的机械映射,不做任何推断:字段在且非空才出声明,没有的不编。
// imports(hub 依赖集): 无
export interface Claim {
  subject: string;
  predicate: string;
  value: unknown;
  origin: 'script';
  evidenceIds: string[];
}

// The predicates this extractor emits, and the item field each rests on. Anything not in
// this table is not asserted — inference is the model's job, not the script's.
const FIELD_PREDICATES: [string, string][] = [
  ['title', 'title'],
  ['state', 'status'],
  ['severity', 'severity'],
  ['priority', 'priority'],
  ['product', 'affects_product'],
  ['openedBuild', 'affects_version'],
  ['resolvedBuild', 'fixed_in_build'],
  ['resolution', 'resolution'],
];

const present = (value: unknown): boolean => {
  if (value === null || value === undefined) return false;
  if (typeof value === 'string') return value.trim() !== '' && value !== '0'; // ZenTao writes "0" for "none"
  if (typeof value === 'object') return Object.keys(value as object).length > 0;
  return true;
};

export function extractDefectClaims(result: unknown, evidenceId: string | null): Claim[] {
  const items = (result as { items?: unknown[] })?.items;
  if (!Array.isArray(items)) throw new Error('not a zentao.bug_detail result: items[] is required');
  if (evidenceId !== null && (typeof evidenceId !== 'string' || !evidenceId)) throw new Error('evidenceId must be a non-empty string or null');
  const claims: Claim[] = [];
  for (const item of items) {
    if (!item || typeof item !== 'object') continue;
    const record = item as Record<string, unknown>;
    const id = String(record.id ?? '');
    if (!id) continue;
    const subject = `defect:${id}`;
    for (const [field, predicate] of FIELD_PREDICATES)
      if (present(record[field])) claims.push({ subject, predicate, value: record[field], origin: 'script', evidenceIds: evidenceId ? [evidenceId] : [] });
    // The legacy Bugzilla id of the repairJoin: "0" means none, so it is absent, not a claim.
    if (present(record.legacyIssueId)) claims.push({ subject, predicate: 'legacy_issue_id', value: record.legacyIssueId, origin: 'script', evidenceIds: evidenceId ? [evidenceId] : [] });
    // The svn commit action carries the fix note verbatim; one claim per such action.
    for (const action of Array.isArray(record.actions) ? record.actions : [])
      if (action && typeof action === 'object' && (action as Record<string, unknown>).action === 'svncommited' && present((action as Record<string, unknown>).comment))
        claims.push({ subject, predicate: 'repair_note', value: { date: (action as Record<string, unknown>).date, actor: (action as Record<string, unknown>).actor, comment: (action as Record<string, unknown>).comment }, origin: 'script', evidenceIds: evidenceId ? [evidenceId] : [] });
  }
  return claims;
}
