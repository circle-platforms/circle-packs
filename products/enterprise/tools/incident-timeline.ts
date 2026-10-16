// Pure function: log text in, ordered timeline and MTTR out. Timestamps are parsed
// without Date so the hub tool sandbox can run this. imports: none.
const LINE = /^(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z) ([a-z0-9-]+) (opened|acknowledged|mitigated|resolved)(?: (.*))?$/;

function invalid(message: string): never {
  const error = new Error(message) as Error & { code: string };
  error.code = 'INVALID_PAYLOAD';
  throw error;
}

export function unixMs(iso: string): number {
  const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})Z$/.exec(iso);
  if (!match) invalid(`Bad timestamp ${iso}`);
  let year = Number(match[1]);
  let month = Number(match[2]);
  const day = Number(match[3]);
  const hour = Number(match[4]);
  const minute = Number(match[5]);
  const second = Number(match[6]);
  if (month < 1 || month > 12 || day < 1 || day > 31 || hour > 23 || minute > 59 || second > 59) invalid(`Bad timestamp ${iso}`);
  const adjust = Math.floor((14 - month) / 12);
  year -= adjust;
  month += 12 * adjust - 3;
  const days = day + Math.floor((153 * month + 2) / 5) + 365 * year + Math.floor(year / 4) - Math.floor(year / 100) + Math.floor(year / 400) - 719469;
  return ((days * 24 + hour) * 60 + minute) * 60 * 1000 + second * 1000;
}

export interface TimelineEvent { at: string; incident: string; event: string; note: string }

export function buildTimeline(text: string): {
  events: TimelineEvent[];
  durations: { incident: string; minutes: number }[];
  incomplete: string[];
  missing: { incident: string; missingFields: string[] }[];
  unparsed: { line: string; missingFields: string[] }[];
  mttrMinutes: number | null;
  origin: 'script';
} {
  if (typeof text !== 'string') invalid('Incident log must be a string');
  if (text.length > 1_000_000) invalid('Incident log exceeds its bound');
  const events: TimelineEvent[] = [];
  const unparsed: { line: string; missingFields: string[] }[] = [];
  for (const line of text.split('\n')) {
    if (!line.trim()) continue;
    const match = LINE.exec(line);
    if (!match) {
      const missingFields: string[] = [];
      if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z(?:\s|$)/.test(line)) missingFields.push('timestamp');
      else {
        const parts = line.slice(21).trim().split(/\s+/);
        if (!/^[a-z0-9-]+$/.test(parts[0] ?? '')) missingFields.push('incident');
        if (!['opened', 'acknowledged', 'mitigated', 'resolved'].includes(parts[1] ?? '')) missingFields.push('event');
      }
      if (!missingFields.length) missingFields.push('line');
      unparsed.push({ line, missingFields });
      continue;
    }
    events.push({ at: match[1], incident: match[2], event: match[3], note: match[4] ?? '' });
  }
  if (events.length > 5000) invalid('Incident log exceeds its event bound');
  events.sort((a, b) => (a.at < b.at ? -1 : a.at > b.at ? 1 : a.incident < b.incident ? -1 : a.incident > b.incident ? 1 : a.event < b.event ? -1 : a.event > b.event ? 1 : 0));
  const marks = new Map<string, Record<string, string>>();
  for (const event of events) {
    const row = marks.get(event.incident) ?? {};
    row[event.event] = event.at;
    marks.set(event.incident, row);
  }
  const durations: { incident: string; minutes: number }[] = [];
  const incomplete: string[] = [];
  const missing: { incident: string; missingFields: string[] }[] = [];
  for (const incident of [...marks.keys()].sort()) {
    const row = marks.get(incident)!;
    const missingFields: string[] = [];
    if (!row.opened) missingFields.push('opened');
    if (!row.resolved) missingFields.push('resolved');
    if (missingFields.length) {
      incomplete.push(incident);
      missing.push({ incident, missingFields });
      continue;
    }
    const minutes = (unixMs(row.resolved) - unixMs(row.opened)) / 60000;
    if (!Number.isFinite(minutes) || minutes < 0) invalid(`Incident ${incident} resolved before it opened`);
    durations.push({ incident, minutes });
  }
  const mttrMinutes = durations.length ? durations.reduce((sum, row) => sum + row.minutes, 0) / durations.length : null;
  return { events, durations, incomplete, missing, unparsed, mttrMinutes, origin: 'script' };
}

const ZONES: Record<string, number> = { UTC: 0, GMT: 0, JST: 540, CST: 480 };

export function parseClock(text: string, zones: Record<string, number> = ZONES): number {
  const match = /^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2})(?::(\d{2}))?(?:\s*(Z|UTC|GMT|JST|CST|[+-]\d{2}:\d{2}))?$/.exec(text.trim());
  if (!match) invalid(`Bad timestamp ${text}`);
  const local = unixMs(`${match[1]}-${match[2]}-${match[3]}T${match[4]}:${match[5]}:${match[6] ?? '00'}Z`);
  const zone = match[7];
  let offset = 0;
  if (zone && zone !== 'Z') {
    if (Object.prototype.hasOwnProperty.call(zones, zone)) offset = zones[zone];
    else if (/^[+-]\d{2}:\d{2}$/.test(zone)) offset = (zone[0] === '-' ? -1 : 1) * (Number(zone.slice(1, 3)) * 60 + Number(zone.slice(4, 6)));
    else invalid(`Bad timestamp ${text}`);
  }
  return local - offset * 60000;
}

export function timelineFromLabels(
  text: string,
  labels: { quote: string; incident: string; event: string; at: string }[],
  policy: { startEvent: string; endEvent: string; events?: string[]; timezones?: Record<string, number> },
): { events: { at: string; incident: string; event: string }[]; durations: { incident: string; minutes: number }[]; mttrMinutes: number; origin: 'script' } {
  if (typeof text !== 'string') invalid('Incident log must be a string');
  const lines = text.split(/\r?\n/).filter((line) => line.trim());
  const allowed = new Set(policy.events ?? [policy.startEvent, policy.endEvent]);
  const labeled = labels.map((label) => {
    if (!lines.includes(label.quote)) invalid('Label quote is not a whole log line');
    if (!label.quote.includes(label.incident) || !label.quote.includes(label.at)) invalid('Label incident or timestamp is not in the quote');
    if (!allowed.has(label.event)) invalid(`Event ${label.event} is not in the policy`);
    return { ...label, atMs: parseClock(label.at, policy.timezones ?? ZONES) };
  });
  const covered = new Set(labeled.map((label) => label.quote));
  const missingLines = lines.filter((line) => !covered.has(line));
  if (missingLines.length) invalid(`Line is not covered: ${missingLines[0]}`);
  const marks = new Map<string, Record<string, { atMs: number }>>();
  for (const label of labeled) {
    const row = marks.get(label.incident) ?? {};
    row[label.event] = label;
    marks.set(label.incident, row);
  }
  const missing: string[] = [];
  const durations: { incident: string; minutes: number }[] = [];
  for (const incident of [...marks.keys()].sort()) {
    const row = marks.get(incident)!;
    const missingFields: string[] = [];
    if (!row[policy.startEvent]) missingFields.push(policy.startEvent);
    if (!row[policy.endEvent]) missingFields.push(policy.endEvent);
    if (missingFields.length) {
      missing.push(`${incident} missing ${missingFields.join(', ')}`);
      continue;
    }
    const minutes = (row[policy.endEvent].atMs - row[policy.startEvent].atMs) / 60000;
    if (!Number.isFinite(minutes) || minutes < 0) invalid(`Incident ${incident} resolved before it opened`);
    durations.push({ incident, minutes });
  }
  if (missing.length) invalid(`Required metrics are missing: ${missing.join('; ')}`);
  const mttrMinutes = durations.reduce((sum, row) => sum + row.minutes, 0) / durations.length;
  return {
    events: [...labeled].sort((a, b) => a.atMs - b.atMs).map((label) => ({ at: label.at, incident: label.incident, event: label.event })),
    durations,
    mttrMinutes,
    origin: 'script',
  };
}

export function buildTimelineFromBytes(bytes: Uint8Array): ReturnType<typeof buildTimeline> {
  return buildTimeline(new TextDecoder('utf-8', { fatal: true }).decode(bytes));
}
