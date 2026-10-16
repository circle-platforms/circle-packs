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
  const match = /^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2})(?::(\d{2}))?\s*(Z|UTC|GMT|JST|CST|[+-]\d{2}:\d{2})$/.exec(text.trim());
  if (!match) {
    if (/^\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}/.test(text.trim())) invalid(`zone_missing: ${text}`);
    invalid(`Bad timestamp ${text}`);
  }
  const local = unixMs(`${match[1]}-${match[2]}-${match[3]}T${match[4]}:${match[5]}:${match[6] ?? '00'}Z`);
  const zone = match[7];
  let offset = 0;
  if (zone !== 'Z') {
    if (Object.prototype.hasOwnProperty.call(zones, zone)) offset = zones[zone];
    else if (/^[+-]\d{2}:\d{2}$/.test(zone)) offset = (zone[0] === '-' ? -1 : 1) * (Number(zone.slice(1, 3)) * 60 + Number(zone.slice(4, 6)));
    else invalid(`Bad timestamp ${text}`);
  }
  return local - offset * 60000;
}

export function timelineFromLabels(
  text: string,
  labels: { quote: string; incident?: string; event: string; at?: string }[],
  policy: { events?: string[]; timezones?: Record<string, number>; metrics: { id: string; start: string; end: string }[] },
): { events: { at: string | null; incident: string | null; event: string }[]; metrics: { id: string; minutes: number }[]; origin: 'script' } {
  if (typeof text !== 'string') invalid('Incident log must be a string');
  const lines = text.split(/\r?\n/).filter((line) => line.trim());
  const allowed = new Set(policy.events ?? policy.metrics.flatMap((metric) => [metric.start, metric.end]));
  const seen = new Set<string>();
  const labeled = labels.map((label) => {
    if (!lines.includes(label.quote)) invalid('Label quote is not a whole log line');
    if (label.at != null && !label.quote.includes(label.at)) invalid('Label timestamp is not in the quote');
    if (!allowed.has(label.event)) invalid(`Event ${label.event} is not in the policy`);
    const incident = label.incident ?? '';
    const key = `${incident}\0${label.event}`;
    if (label.event !== 'other' && seen.has(key)) invalid(`duplicate_label: ${label.event}`);
    if (label.event !== 'other') seen.add(key);
    const atMs = label.at == null ? null : parseClock(label.at, policy.timezones ?? ZONES);
    return { ...label, incident: label.incident ?? null, at: label.at ?? null, atMs };
  });
  const covered = new Set(labeled.map((label) => label.quote));
  const missingLines = lines.filter((line) => !covered.has(line));
  if (missingLines.length) invalid(`Line is not covered: ${missingLines[0]}`);
  const marks = new Map<string, Record<string, { atMs: number }>>();
  for (const label of labeled) {
    if (label.event === 'other' || label.atMs == null) continue;
    const key = label.incident ?? '';
    const row = marks.get(key) ?? {};
    row[label.event] = { atMs: label.atMs };
    marks.set(key, row);
  }
  const metrics = policy.metrics.map((metric) => {
    const missing: string[] = [];
    const minutes: number[] = [];
    for (const [incident, row] of marks) {
      const absent = [metric.start, metric.end].filter((event) => !row[event]);
      if (absent.length) missing.push(`${incident || '(none)'} missing ${absent.join(', ')}`);
      else minutes.push((row[metric.end].atMs - row[metric.start].atMs) / 60000);
    }
    if (missing.length || !minutes.length) invalid(`metrics_missing: ${missing.join('; ') || metric.id}`);
    return { id: metric.id, minutes: minutes.reduce((sum, value) => sum + value, 0) / minutes.length };
  });
  return {
    events: labeled.map((label) => ({ at: label.at, incident: label.incident, event: label.event })),
    metrics,
    origin: 'script',
  };
}

export function buildTimelineFromBytes(bytes: Uint8Array): ReturnType<typeof buildTimeline> {
  return buildTimeline(new TextDecoder('utf-8', { fatal: true }).decode(bytes));
}
