// Pure function: checklist completion and access requests. Policy prose is not written here.
// imports: none.
export const REQUIRED_ITEMS = ['identity', 'equipment', 'accounts', 'policies', 'manager'] as const;
export const STARTER_ROLES = ['employee-mail', 'employee-directory'] as const;

function invalid(message: string): never {
  const error = new Error(message) as Error & { code: string };
  error.code = 'INVALID_PAYLOAD';
  throw error;
}

export function checklistStatus(completed: unknown): { item: string; status: 'done' | 'missing' }[] {
  if (!Array.isArray(completed)) invalid('Completed items must be an array');
  const done = new Set(completed);
  for (const item of done) if (typeof item !== 'string' || !REQUIRED_ITEMS.includes(item as (typeof REQUIRED_ITEMS)[number])) invalid(`Unknown checklist item ${String(item)}`);
  return REQUIRED_ITEMS.map((item) => ({ item, status: done.has(item) ? 'done' as const : 'missing' as const }));
}

const ROLE = /^[\u3400-\u9fffA-Za-z0-9_:-]{1,40}$/;

function addCalendarDays(iso: string, days: number): string {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
  if (!match) invalid(`Bad date ${iso}`);
  let year = Number(match[1]);
  let month = Number(match[2]);
  let day = Number(match[3]) + days;
  const dim = (y: number, m: number) => (m === 2 ? ((y % 4 === 0 && y % 100 !== 0) || y % 400 === 0 ? 29 : 28) : [0, 31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31][m]);
  while (day > dim(year, month)) {
    day -= dim(year, month);
    month += 1;
    if (month > 12) { month = 1; year += 1; }
  }
  return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

export function evaluateAccess(requests: unknown, rules: { role: string; effect: 'permit' | 'forbid' | 'downgrade'; grant?: string; minTenure?: { value: number; unit: 'day' | 'month' }; after?: { value: number; unit: 'day' | 'month' }; approver?: string }[]): { person: string; role: string; system: string; needsApproval: boolean; decision: 'permit' | 'forbid' | 'downgrade' | 'tenure_short' | 'not_yet' | 'uncovered'; grant?: string; grantDate?: string; approver?: string; origin: 'script' }[] {
  if (!Array.isArray(requests)) invalid('Access requests must be an array');
  if (requests.length > 100) invalid('Access requests exceed their bound');
  return requests.map((request, index) => {
    if (!request || typeof request !== 'object') invalid(`Access request ${index} is not an object`);
    const row = request as Record<string, unknown>;
    for (const key of ['person', 'role', 'system']) if (typeof row[key] !== 'string' || !ROLE.test(row[key] as string)) invalid(`Access request ${index} ${key} is malformed`);
    const tenure = row.tenure as { value?: number; unit?: string } | undefined;
    if (tenure != null && (typeof tenure.value !== 'number' || (tenure.unit !== 'day' && tenure.unit !== 'month'))) invalid(`Access request ${index} tenure is malformed`);
    const matched = rules.filter((rule) => rule.role === row.role);
    const downgrade = matched.find((rule) => rule.effect === 'downgrade');
    const forbid = matched.find((rule) => rule.effect === 'forbid');
    const permit = matched.find((rule) => rule.effect === 'permit');
    const chosen = downgrade ?? forbid ?? permit;
    const waiting = chosen?.after ?? chosen?.minTenure;
    if (waiting && tenure && tenure.unit !== waiting.unit) invalid(`unit_mismatch: ${String(row.role)}`);
    const met = !waiting || (tenure != null && (tenure.value as number) >= waiting.value);
    const decision = !chosen ? 'uncovered' as const : downgrade && !met ? 'not_yet' as const : permit && waiting && !met ? 'tenure_short' as const : forbid ? 'forbid' as const : chosen.effect;
    const startDate = typeof row.startDate === 'string' ? row.startDate : null;
    const grantDate = startDate && waiting?.unit === 'day' ? addCalendarDays(startDate, waiting.value) : startDate && !waiting ? startDate : undefined;
    return {
      person: row.person as string,
      role: row.role as string,
      system: row.system as string,
      needsApproval: decision !== 'permit' && decision !== 'downgrade',
      decision,
      ...(chosen?.grant && (decision === 'downgrade' || decision === 'not_yet') ? { grant: chosen.grant } : {}),
      ...(grantDate ? { grantDate } : {}),
      ...(chosen?.approver ? { approver: chosen.approver } : {}),
      origin: 'script' as const,
    };
  });
}

export function accessRequests(requests: unknown): ReturnType<typeof evaluateAccess> {
  return evaluateAccess(requests, STARTER_ROLES.map((role) => ({ role, effect: 'permit' as const })));
}
