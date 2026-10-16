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

export function evaluateAccess(requests: unknown, rules: { role: string; effect: 'permit' | 'forbid' }[]): { person: string; role: string; system: string; needsApproval: boolean; decision: 'permit' | 'forbid' | 'uncovered'; origin: 'script' }[] {
  if (!Array.isArray(requests)) invalid('Access requests must be an array');
  if (requests.length > 100) invalid('Access requests exceed their bound');
  return requests.map((request, index) => {
    if (!request || typeof request !== 'object') invalid(`Access request ${index} is not an object`);
    const row = request as Record<string, unknown>;
    for (const key of ['person', 'role', 'system']) if (typeof row[key] !== 'string' || !/^[a-z0-9-]{1,40}$/.test(row[key] as string)) invalid(`Access request ${index} ${key} is malformed`);
    const matched = rules.filter((rule) => rule.role === row.role);
    const decision = matched.some((rule) => rule.effect === 'forbid') ? 'forbid' as const : matched.some((rule) => rule.effect === 'permit') ? 'permit' as const : 'uncovered' as const;
    return {
      person: row.person as string,
      role: row.role as string,
      system: row.system as string,
      needsApproval: decision !== 'permit',
      decision,
      origin: 'script' as const,
    };
  });
}

export function accessRequests(requests: unknown): ReturnType<typeof evaluateAccess> {
  return evaluateAccess(requests, STARTER_ROLES.map((role) => ({ role, effect: 'permit' as const })));
}
