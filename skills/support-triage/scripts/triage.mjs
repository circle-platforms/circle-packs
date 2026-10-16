#!/usr/bin/env node
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';

function readJson(path) {
  try { return JSON.parse(readFileSync(path, 'utf8')); }
  catch { throw new Error(`${path}: unreadable`); }
}
function loadSaved(folder, arg) {
  let parsed = readJson(arg);
  if (parsed && typeof parsed.savedAs === 'string' && parsed.savedAs.trim()) {
    const path = [parsed.savedAs, resolve(dirname(arg), '..', '..', parsed.savedAs), resolve(folder, parsed.savedAs)].find((candidate) => existsSync(candidate));
    if (!path) throw new Error(`${arg}: pointer target ${parsed.savedAs} not found`);
    parsed = readJson(path);
  }
  const raw = parsed.response ?? parsed;
  if (!raw?.result) throw new Error(`${arg}: not a hub tool return`);
  return { result: raw.result, evidenceId: raw.evidence?.[0]?.evidenceId ?? null };
}
function documentJson(result) {
  const bytes = Buffer.from(result.contentBase64, 'base64');
  const text = bytes.toString('utf8');
  if (!Buffer.from(text).equals(bytes)) throw new Error('document is not UTF-8');
  return JSON.parse(text);
}
export function priorityOf(ticket) {
  if (ticket.severity === 1 || (ticket.severity === 2 && ticket.tier === 'contract')) return 'P1';
  if (ticket.severity === 2 || ticket.tier === 'priority') return 'P2';
  if (ticket.severity === 3) return 'P3';
  return 'P4';
}
export function sectionText(result) {
  if (!Array.isArray(result?.lines)) throw new Error('docs.section result has no lines');
  return result.lines.map((line) => line.text).join('\n');
}

export function triage(folder, ticketsSaved, sectionSaved, replies) {
  if (!Array.isArray(replies?.replies)) throw new Error('replies.json needs replies[]');
  const payload = documentJson(ticketsSaved.result);
  const tickets = Array.isArray(payload.tickets) ? payload.tickets : payload;
  const ranked = tickets.map((ticket) => ({ id: ticket.id, subject: ticket.subject, severity: ticket.severity, tier: ticket.tier, priority: priorityOf(ticket), origin: 'script' }));
  const text = sectionText(sectionSaved.result);
  const rendered = [];
  const gaps = [];
  for (const reply of replies.replies) {
    if (reply.origin !== 'model') throw new Error(`reply ${reply.ticketId} must be model judgement`);
    const quoted = typeof reply.quote === 'string' && reply.quote.length > 0 && text.includes(reply.quote);
    rendered.push(`## ${reply.ticketId}\n\n${reply.body}\n\n${quoted ? `Quoted (script-checked): ${reply.quote}` : 'No knowledge-base quote.'}`);
    if (!quoted) gaps.push({ subject: `ticket:${reply.ticketId}`, predicate: 'kb_gap', value: reply.ticketId, origin: 'script', evidenceIds: sectionSaved.evidenceId ? [sectionSaved.evidenceId] : [] });
  }
  mkdirSync(join(folder, 'out'), { recursive: true });
  writeFileSync(join(folder, 'out', 'triage.json'), `${JSON.stringify(ranked, null, 2)}\n`);
  writeFileSync(join(folder, 'out', 'replies.md'), `# Reply drafts\n\nPriority is a script. Reply text is model judgement.\n\n${rendered.join('\n\n')}\n`);
  writeFileSync(join(folder, 'out', 'kb_gaps.json'), `${JSON.stringify(gaps, null, 2)}\n`);
  return { ranked, gaps };
}

if (process.argv[1] && import.meta.url === `file://${process.argv[1]}`) {
  const [folder, ...rest] = process.argv.slice(2);
  let get, section, replies;
  for (let i = 0; i < rest.length; i++) {
    if (rest[i] === '--get') get = rest[++i];
    else if (rest[i] === '--section') section = rest[++i];
    else if (rest[i] === '--replies') replies = rest[++i];
  }
  if (!folder || !get || !section || !replies) {
    console.error('usage: node triage.mjs <folder> --get <tickets> --section <section> --replies <replies.json>');
    process.exit(2);
  }
  triage(folder, loadSaved(folder, get), loadSaved(folder, section), readJson(replies));
}
