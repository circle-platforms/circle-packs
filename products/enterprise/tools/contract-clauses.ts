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

export function extractClausesFromBytes(bytes: Uint8Array): ReturnType<typeof extractClauses> {
  const text = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  return extractClauses(text);
}
