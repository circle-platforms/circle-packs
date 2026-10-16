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
    const match = /^(?:#{1,3} |\d+\. )(.+?)\s*$/.exec(lines[i]);
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

export function scoreClauses(
  text: string,
  clauses: { id: string; heading: string; effect: string; value: string; quote: string }[],
  policy: { required: string[]; defaultRisk: string; rules: { id: string; heading: string; effect: string; valuePattern?: string; risk: string }[] },
): { scored: ClauseScore[]; absent: string[]; unextracted: string[] } {
  const headings = extractClauses(text).clauses;
  const scored = clauses.map((clause) => {
    const section = headings.find((item) => item.heading === clause.heading);
    if (!section) invalid(`Heading ${clause.heading} is not in the source`);
    const sectionText = `${clause.heading}\n${section.text}`;
    if (!sectionText.includes(clause.quote) && !section.text.includes(clause.quote)) invalid(`Quote for ${clause.id} is not in the source`);
    if (!clause.quote.includes(clause.value)) invalid(`Value for ${clause.id} is not inside the quote`);
    const rules = policy.rules.filter((rule) => rule.heading === clause.heading && rule.effect === clause.effect);
    let risk = policy.defaultRisk;
    let ruleId: string | null = null;
    for (const rule of rules) {
      if (!rule.valuePattern || new RegExp(rule.valuePattern).test(clause.value)) {
        risk = rule.risk;
        ruleId = rule.id;
        break;
      }
    }
    if (clause.effect !== 'permit' && clause.effect !== 'forbid') invalid(`Effect for ${clause.id} is malformed`);
    return { id: clause.id, heading: clause.heading, effect: clause.effect, value: clause.value, risk, ruleId, origin: 'script' as const };
  });
  const present = new Set(headings.map((item) => item.heading));
  const extracted = new Set(scored.map((clause) => clause.heading));
  return {
    scored,
    absent: policy.required.filter((heading) => !present.has(heading)),
    unextracted: policy.required.filter((heading) => present.has(heading) && !extracted.has(heading)),
  };
}

export function extractClausesFromBytes(bytes: Uint8Array): ReturnType<typeof extractClauses> {
  const text = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  return extractClauses(text);
}
