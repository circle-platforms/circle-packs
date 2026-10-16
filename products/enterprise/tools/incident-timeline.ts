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
  mttrMinutes: number | null;
  origin: 'script';
} {
  if (typeof text !== 'string') invalid('Incident log must be a string');
  if (text.length > 1_000_000) invalid('Incident log exceeds its bound');
  const events: TimelineEvent[] = [];
  for (const line of text.split('\n')) {
    if (!line.trim()) continue;
    const match = LINE.exec(line);
    if (!match) invalid(`Unreadable log line: ${line.slice(0, 120)}`);
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
  for (const incident of [...marks.keys()].sort()) {
    const row = marks.get(incident)!;
    if (!row.opened || !row.resolved) {
      incomplete.push(incident);
      continue;
    }
    const minutes = (unixMs(row.resolved) - unixMs(row.opened)) / 60000;
    if (!Number.isFinite(minutes) || minutes < 0) invalid(`Incident ${incident} resolved before it opened`);
    durations.push({ incident, minutes });
  }
  const mttrMinutes = durations.length ? durations.reduce((sum, row) => sum + row.minutes, 0) / durations.length : null;
  return { events, durations, incomplete, mttrMinutes, origin: 'script' };
}

export function buildTimelineFromBytes(bytes: Uint8Array): ReturnType<typeof buildTimeline> {
  return buildTimeline(new TextDecoder('utf-8', { fatal: true }).decode(bytes));
}
