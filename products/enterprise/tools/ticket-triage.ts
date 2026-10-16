// Pure function: ticket bytes in, priority out. Reply text is not invented here.
// imports: none.
export interface Ticket {
  id: string;
  subject: string;
  severity: number;
  tier: 'standard' | 'priority' | 'contract';
}

function invalid(message: string): never {
  const error = new Error(message) as Error & { code: string };
  error.code = 'INVALID_PAYLOAD';
  throw error;
}

export function priorityOf(ticket: { severity: number; tier: string }): 'P1' | 'P2' | 'P3' | 'P4' {
  if (ticket.severity === 1 || (ticket.severity === 2 && ticket.tier === 'contract')) return 'P1';
  if (ticket.severity === 2 || ticket.tier === 'priority') return 'P2';
  if (ticket.severity === 3) return 'P3';
  return 'P4';
}

export function triageTickets(tickets: unknown): { id: string; subject: string; severity: number; tier: string; priority: string; origin: 'script' }[] {
  if (!Array.isArray(tickets)) invalid('Tickets must be an array');
  if (tickets.length > 500) invalid('Ticket batch exceeds its bound');
  return tickets.map((ticket, index) => {
    if (!ticket || typeof ticket !== 'object') invalid(`Ticket ${index} is not an object`);
    const row = ticket as Record<string, unknown>;
    if (typeof row.id !== 'string' || !/^[A-Za-z0-9-]{1,40}$/.test(row.id)) invalid(`Ticket ${index} id is malformed`);
    if (typeof row.subject !== 'string' || !row.subject || row.subject.length > 200) invalid(`Ticket ${index} subject is malformed`);
    if (![1, 2, 3, 4].includes(row.severity as number)) invalid(`Ticket ${index} severity must be 1..4`);
    if (!['standard', 'priority', 'contract'].includes(row.tier as string)) invalid(`Ticket ${index} tier is malformed`);
    return {
      id: row.id,
      subject: row.subject,
      severity: row.severity as number,
      tier: row.tier as string,
      priority: priorityOf({ severity: row.severity as number, tier: row.tier as string }),
      origin: 'script' as const,
    };
  });
}

const CREDENTIAL = /(?:password|api[_-]?key|secret|token)\s*[:=]\s*\S+|Bearer\s+\S+|\bsk-[A-Za-z0-9]{8,}/i;

export function routeTickets(
  tickets: { id: string; subject: string; severity: number; tier: string; body?: string }[],
  intents: { id: string; intent: string; quote: string }[],
  policy: { intents: Record<string, { queue: string; responseMinutes: number }>; default: { queue: string; responseMinutes: number }; credential: { queue: string; responseMinutes: number } },
): { id: string; intent: string; queue: string; responseMinutes: number; priority: string; credential: boolean; origin: 'script' }[] {
  return intents.map((item) => {
    const ticket = tickets.find((row) => row.id === item.id);
    if (!ticket) invalid(`Ticket ${item.id} is not in the source`);
    const blob = `${ticket.subject}\n${ticket.body ?? ''}`;
    if (!blob.includes(item.quote)) invalid(`Quote for ${item.id} is not in the source`);
    const credential = CREDENTIAL.test(blob);
    const listed = policy.intents[item.intent];
    const route = credential ? policy.credential : listed ?? policy.default;
    return { id: item.id, intent: item.intent, queue: route.queue, responseMinutes: route.responseMinutes, priority: priorityOf(ticket), credential, origin: 'script' as const };
  });
}

export function triageTicketBytes(bytes: Uint8Array): ReturnType<typeof triageTickets> {
  let parsed: unknown;
  try {
    parsed = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes));
  } catch {
    invalid('Ticket bytes are not UTF-8 JSON');
  }
  const tickets = parsed && typeof parsed === 'object' && Array.isArray((parsed as { tickets?: unknown }).tickets) ? (parsed as { tickets: unknown }).tickets : parsed;
  return triageTickets(tickets);
}
