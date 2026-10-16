// Hook handler (hub-hook/1): beforeDispatch — block an access grant whose role is
// not on the closed list declared for this resource. Anything else passes.
// Only what is provably true is blocked. imports: none (hooks cannot import).
export default function handle(input) {
  const subject = input && input.subject ? input.subject : {};
  const request = subject.input && typeof subject.input === 'object' ? subject.input : {};
  if (request.action !== 'access-grant') return { decision: 'pass' };
  const declaration = input && input.binding && input.binding.resource && input.binding.resource.declaration ? input.binding.resource.declaration : {};
  const approved = declaration.approvedRoles;
  const role = typeof request.role === 'string' ? request.role : null;
  if (!Array.isArray(approved) || approved.length === 0) return { decision: 'block', code: 'ACCESS_ROLES_UNDECLARED', facts: { action: 'access-grant', role } };
  if (!role) return { decision: 'block', code: 'ACCESS_ROLE_MISSING', facts: { action: 'access-grant' } };
  if (!approved.includes(role)) return { decision: 'block', code: 'ACCESS_ROLE_UNAPPROVED', facts: { action: 'access-grant', role } };
  return { decision: 'pass' };
}
