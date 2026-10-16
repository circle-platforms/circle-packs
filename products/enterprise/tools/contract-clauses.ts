// Pure function: contract text bytes in, clause list and missing required headings out.
// No environment, network or file writes. imports: none.
const REQUIRED = ['Payment terms', 'Termination', 'Liability', 'Data protection'];

function invalid(message: string): never {
  const error = new Error(message) as Error & { code: string };
  error.code = 'INVALID_PAYLOAD';
  throw error;
}

export function extractClauses(text: string): { clauses: { id: string; heading: string; text: string }[]; gaps: string[] } {
  if (typeof text !== 'string') invalid('Contract text must be a string');
  if (text.length > 1_000_000) invalid('Contract text exceeds its bound');
  const lines = text.split('\n');
  const headings: { index: number; heading: string }[] = [];
  for (let i = 0; i < lines.length; i++) {
    const match = /^(?:#{1,6} |\d+[.、] |第[0-9０-９一二三四五六七八九十百零]+条\s*)(.+?)\s*$/.exec(lines[i].trim());
    if (match) headings.push({ index: i, heading: match[1] });
  }
  const clauses = headings.map((heading, index) => {
    const end = headings[index + 1]?.index ?? lines.length;
    return { id: `c${index + 1}`, heading: heading.heading, text: lines.slice(heading.index + 1, end).join('\n').trim() };
  });
  const present = new Set(clauses.map((clause) => clause.heading));
  return { clauses, gaps: REQUIRED.filter((heading) => !present.has(heading)) };
}

export interface ClauseScore {
  id: string;
  heading: string;
  effect: 'permit' | 'forbid';
  value: string;
  risk: string;
  ruleId: string | null;
  origin: 'script';
}

const POLARITY: [string, string][] = [['shall not', 'forbid'], ['must not', 'forbid'], ['may not', 'forbid'], ['不得', 'forbid'], ['禁止', 'forbid'], ['不可', 'forbid'], ['不应', 'forbid'], ['可以', 'permit'], ['应当', 'permit'], ['shall', 'permit'], ['must', 'permit'], ['may', 'permit'], ['降为', 'downgrade'], ['不', 'forbid'], ['可', 'permit'], ['应', 'permit'], ['not', 'forbid']];

function polarityOf(quote: string, cue: string): string {
  if (!quote.includes(cue)) invalid('Polarity cue is not a span of the quote');
  const used: [number, number][] = [];
  let found: string | null = null;
  for (const [phrase, effect] of POLARITY) {
    let from = 0;
    while (from < quote.length) {
      const at = quote.indexOf(phrase, from);
      if (at < 0) break;
      const end = at + phrase.length;
      const ascii = /^[A-Za-z ]+$/.test(phrase);
      const boundary = !ascii || ((at === 0 || !/[A-Za-z]/.test(quote[at - 1])) && (end === quote.length || !/[A-Za-z]/.test(quote[end])));
      const overlaps = used.some(([start, stop]) => at < stop && end > start);
      if (boundary && !overlaps) {
        if (phrase === cue) found = effect;
        used.push([at, end]);
        from = end;
      } else from = at + 1;
    }
  }
  if (!found) invalid(`Polarity cue ${cue} does not match the effect`);
  return found;
}

function dayCount(value: string): number | null {
  const match = /(\d+)\s*(?:days|日|天)/i.exec(value);
  return match ? Number(match[1]) : null;
}

type PolicyTopic = string | { id: string; headings: string[] };
type PolicyRule = { id: string; heading?: string; topic?: string; effect: string; valuePattern?: string; maxDays?: number; minDays?: number; risk: string };

function topicKey(heading: string, required: PolicyTopic[]): string | null {
  if (required.every((item) => typeof item === 'string')) return heading;
  const found = required.find((item) => typeof item !== 'string' && item.headings.some((name) => heading === name || heading.includes(name)));
  return found && typeof found !== 'string' ? found.id : null;
}

export function scoreClauses(
  text: string,
  clauses: { id: string; heading: string; effect: string; value: string; quote: string; cue?: string }[],
  policy: { required: PolicyTopic[]; defaultRisk: string; rules: PolicyRule[] },
): { scored: ClauseScore[]; absent: string[]; unextracted: string[] } {
  const headings = extractClauses(text).clauses;
  const present = new Set(headings.map((item) => item.heading));
  const scored = clauses.map((clause) => {
    const section = headings.find((item) => item.heading === clause.heading);
    if (!section) invalid(`Heading ${clause.heading} is not in the source`);
    const sectionText = `${clause.heading}\n${section.text}`;
    if (!sectionText.includes(clause.quote) && !section.text.includes(clause.quote)) invalid(`Quote for ${clause.id} is not in the source`);
    if (!clause.quote.includes(clause.value)) invalid(`Value for ${clause.id} is not inside the quote`);
    if (clause.effect !== 'permit' && clause.effect !== 'forbid') invalid(`Effect for ${clause.id} is malformed`);
    if (clause.cue && polarityOf(clause.quote, clause.cue) !== clause.effect) invalid(`Effect for ${clause.id} does not match its polarity cue`);
    const topic = topicKey(clause.heading, policy.required);
    const days = dayCount(clause.value);
    const rules = policy.rules.filter((rule) => (rule.topic ?? rule.heading) === (rule.topic ? topic : clause.heading) && rule.effect === clause.effect);
    let risk = policy.defaultRisk;
    let ruleId: string | null = null;
    for (const rule of rules) {
      if (rule.maxDays != null && (days == null || days > rule.maxDays)) continue;
      if (rule.minDays != null && (days == null || days < rule.minDays)) continue;
      if (rule.valuePattern && !new RegExp(rule.valuePattern).test(clause.value)) continue;
      risk = rule.risk;
      ruleId = rule.id;
      break;
    }
    return { id: clause.id, heading: clause.heading, effect: clause.effect, value: clause.value, risk, ruleId, origin: 'script' as const };
  });
  const extracted = new Set(scored.map((clause) => clause.heading));
  const names = policy.required.map((item) => (typeof item === 'string' ? item : item.id));
  const covered = policy.required.every((item) => typeof item === 'string')
    ? present
    : new Set(headings.map((item) => topicKey(item.heading, policy.required)).filter((item): item is string => Boolean(item)));
  return {
    scored,
    absent: names.filter((name) => !covered.has(name)),
    unextracted: names.filter((name, index) => {
      const item = policy.required[index];
      if (typeof item === 'string') return present.has(item) && !extracted.has(item);
      return item.headings.some((heading) => [...present].some((title) => title === heading || title.includes(heading))) && !scored.some((clause) => topicKey(clause.heading, policy.required) === item.id);
    }),
  };
}

export function extractClausesFromBytes(bytes: Uint8Array): ReturnType<typeof extractClauses> {
  const text = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  return extractClauses(text);
}
