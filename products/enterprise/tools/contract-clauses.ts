// Pure function: contract text bytes in, clause headings out.
// Risk is a table lookup after two extracts agree. imports: none.
const CN_DIGIT: Record<string, number> = { 零: 0, 〇: 0, 一: 1, 二: 2, 两: 2, 三: 3, 四: 4, 五: 5, 六: 6, 七: 7, 八: 8, 九: 9 };

function invalid(message: string): never {
  const error = new Error(message) as Error & { code: string };
  error.code = 'INVALID_PAYLOAD';
  throw error;
}

const ARTICLE = /^(第[0-9０-９一二三四五六七八九十百零]+条)(?:[ \t]+(.*))?$/;

export function splitHeadingLine(line: string): { heading: string } | null {
  const trimmed = line.trim();
  const article = ARTICLE.exec(trimmed);
  if (article) {
    const rest = (article[2] ?? '').trim();
    if (!rest) return { heading: article[1] };
    const colon = /[：:]/.exec(rest);
    if (colon && colon.index > 0 && colon.index <= 12) {
      const title = rest.slice(0, colon.index).trim();
      if (title.length >= 1 && title.length <= 12 && !/[。！？]/.test(title)) return { heading: title };
    }
    if (/^[\u3400-\u9fffA-Za-z0-9 ]{1,12}$/.test(rest)) return { heading: rest };
    return { heading: article[1] };
  }
  const markdown = /^(?:#{1,6}[ \t]+|\d+[.、][ \t]*)(.+)$/.exec(trimmed);
  if (markdown) return { heading: markdown[1].trim() };
  return null;
}

export function extractClauses(text: string): { clauses: { id: string; heading: string; text: string }[] } {
  if (typeof text !== 'string') invalid('Contract text must be a string');
  if (text.length > 1_000_000) invalid('Contract text exceeds its bound');
  const lines = text.split('\n');
  const headings: { index: number; heading: string }[] = [];
  for (let i = 0; i < lines.length; i++) {
    const split = splitHeadingLine(lines[i]);
    if (split) headings.push({ index: i, heading: split.heading });
  }
  const clauses = headings.map((heading, index) => {
    const end = headings[index + 1]?.index ?? lines.length;
    return { id: `c${index + 1}`, heading: heading.heading, text: lines.slice(heading.index + 1, end).join('\n').trim() };
  });
  return { clauses };
}

export function parseChineseInteger(text: string): number | null {
  if (/^\d+$/.test(text)) return Number(text);
  let total = 0;
  let current = 0;
  for (const ch of text) {
    if (Object.prototype.hasOwnProperty.call(CN_DIGIT, ch)) current = CN_DIGIT[ch];
    else if (ch === '十' || ch === '百' || ch === '千') {
      const scale = ch === '十' ? 10 : ch === '百' ? 100 : 1000;
      total += (current || 1) * scale;
      current = 0;
    } else return null;
  }
  return total + current;
}

export function parseQuantity(text: string): { value: number; unit: 'day' | 'month' } | null {
  const match = /([0-9]+|[零〇一两二三四五六七八九十百千]+)\s*个?\s*(天|日|月|days?|months?)/i.exec(text);
  if (!match) return null;
  const value = parseChineseInteger(match[1]);
  if (value == null) return null;
  return { value, unit: match[2] === '月' || /^months?$/i.test(match[2]) ? 'month' : 'day' };
}

export interface TermRule { id: string; topic: string; kind: string; unit: 'day'; minDays: number; belowRisk: string; metRisk: string }

export function scoreTerm(quantity: { value: number; unit: string } | null, rule: TermRule): { risk: string | null; ruleId: string | null } {
  if (!quantity || quantity.unit !== 'day' || rule.unit !== 'day') return { risk: null, ruleId: null };
  return { risk: quantity.value < rule.minDays ? rule.belowRisk : rule.metRisk, ruleId: rule.id };
}

export function agreeKind(left: string, right: string): { decision: 'agreed' | 'needs_human'; kind: string | null } {
  if (left !== right) return { decision: 'needs_human', kind: null };
  return { decision: 'agreed', kind: left };
}

export function extractClausesFromBytes(bytes: Uint8Array): ReturnType<typeof extractClauses> {
  const text = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  return extractClauses(text);
}
