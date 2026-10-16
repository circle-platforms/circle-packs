#!/usr/bin/env node
// Step 2 (script): merge docs.get extracts into report.json and report.xlsx.
// Formulas on Summary are SUMIF and B1-B2. The zip is stored, method 0, timestamp fixed.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';

export const FORMULAS = {
  revenue: 'SUMIF(Lines!C:C,"revenue",Lines!D:D)',
  expense: 'SUMIF(Lines!C:C,"expense",Lines!D:D)',
  margin: 'B1-B2',
};

const CRC = new Uint32Array(256).map((_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});
const crc32 = (bytes) => {
  let c = 0xffffffff;
  for (const byte of bytes) c = CRC[(c ^ byte) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
};
const concat = (parts) => Buffer.concat(parts);
function zipStored(entries) {
  const locals = [];
  const central = [];
  let offset = 0;
  const dosDate = (1 << 5) | 1;
  for (const [name, data] of entries) {
    const file = Buffer.from(name);
    const crc = crc32(data);
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(0x0800, 6);
    local.writeUInt16LE(0, 8);
    local.writeUInt16LE(dosDate, 12);
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(data.length, 18);
    local.writeUInt32LE(data.length, 22);
    local.writeUInt16LE(file.length, 26);
    locals.push(local, file, data);
    const header = Buffer.alloc(46);
    header.writeUInt32LE(0x02014b50, 0);
    header.writeUInt16LE(20, 4);
    header.writeUInt16LE(20, 6);
    header.writeUInt16LE(0x0800, 8);
    header.writeUInt16LE(dosDate, 14);
    header.writeUInt32LE(crc, 16);
    header.writeUInt32LE(data.length, 20);
    header.writeUInt32LE(data.length, 24);
    header.writeUInt16LE(file.length, 28);
    header.writeUInt32LE(offset, 42);
    central.push(header, file);
    offset += 30 + file.length + data.length;
  }
  const directory = concat(central);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(entries.length, 8);
  end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(directory.length, 12);
  end.writeUInt32LE(offset, 16);
  return concat([...locals, directory, end]);
}
const escapeXml = (text) => String(text).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
function sheetXml(rows) {
  const lines = rows.map((cells, rowIndex) => {
    const number = rowIndex + 1;
    const body = cells.map((value, column) => {
      if (value === null || value === undefined || value === '') return '';
      const ref = `${String.fromCharCode(65 + column)}${number}`;
      if (typeof value === 'number') return `<c r="${ref}"><v>${value}</v></c>`;
      if (typeof value === 'object') return `<c r="${ref}"><f>${escapeXml(value.formula)}</f><v>${value.result}</v></c>`;
      return `<c r="${ref}" t="inlineStr"><is><t xml:space="preserve">${escapeXml(value)}</t></is></c>`;
    }).join('');
    return `<row r="${number}">${body}</row>`;
  });
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData>${lines.join('')}</sheetData></worksheet>`;
}

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
  if (!raw?.result?.contentBase64) throw new Error(`${arg}: docs.get result has no contentBase64`);
  const bytes = Buffer.from(raw.result.contentBase64, 'base64');
  const text = bytes.toString('utf8');
  if (!Buffer.from(text).equals(bytes)) throw new Error(`${arg}: document is not UTF-8`);
  return JSON.parse(text);
}
const label = (value, field) => {
  if (typeof value !== 'string' || !/^[A-Za-z0-9 ._-]{1,80}$/.test(value)) throw new Error(`${field} is malformed`);
  return value;
};

export function summarise(period, sources) {
  if (!/^[A-Za-z0-9 ._-]{1,40}$/.test(period)) throw new Error('period is malformed');
  const rows = [];
  for (const source of sources) {
    label(source.name, 'source name');
    for (const row of source.rows ?? []) {
      label(row.account, 'account');
      if (row.kind !== 'revenue' && row.kind !== 'expense') throw new Error('kind must be revenue or expense');
      if (typeof row.amount !== 'number' || !Number.isFinite(row.amount)) throw new Error('amount must be a finite number');
      rows.push({ source: source.name, account: row.account, kind: row.kind, amount: row.amount });
    }
  }
  rows.sort((a, b) => (a.source < b.source ? -1 : a.source > b.source ? 1 : a.account < b.account ? -1 : a.account > b.account ? 1 : a.kind < b.kind ? -1 : 1));
  const revenue = rows.filter((row) => row.kind === 'revenue').reduce((sum, row) => sum + row.amount, 0);
  const expense = rows.filter((row) => row.kind === 'expense').reduce((sum, row) => sum + row.amount, 0);
  return { period, rows, revenue, expense, margin: revenue - expense, formulas: { ...FORMULAS }, origin: 'script' };
}

export function workbook(summary) {
  const lines = [['Source', 'Account', 'Kind', 'Amount'], ...summary.rows.map((row) => [row.source, row.account, row.kind, row.amount])];
  const totals = [
    ['Revenue', { formula: FORMULAS.revenue, result: summary.revenue }],
    ['Expense', { formula: FORMULAS.expense, result: summary.expense }],
    ['Margin', { formula: FORMULAS.margin, result: summary.margin }],
  ];
  const encode = (text) => Buffer.from(text);
  const styles = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><fonts count="1"><font><sz val="11"/><name val="Calibri"/></font></fonts><fills count="2"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill></fills><borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders><cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs><cellXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/></cellXfs></styleSheet>';
  return zipStored([
    ['[Content_Types].xml', encode('<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/><Override PartName="/xl/worksheets/sheet2.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/><Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/></Types>')],
    ['_rels/.rels', encode('<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>')],
    ['xl/workbook.xml', encode('<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="Lines" sheetId="1" r:id="rId1"/><sheet name="Summary" sheetId="2" r:id="rId2"/></sheets></workbook>')],
    ['xl/_rels/workbook.xml.rels', encode('<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet2.xml"/><Relationship Id="rId3" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>')],
    ['xl/styles.xml', encode(styles)],
    ['xl/worksheets/sheet1.xml', encode(sheetXml(lines))],
    ['xl/worksheets/sheet2.xml', encode(sheetXml(totals))],
  ]);
}

export function aggregate(folder, period, sources) {
  const summary = summarise(period, sources);
  mkdirSync(join(folder, 'out'), { recursive: true });
  writeFileSync(join(folder, 'out', 'report.json'), `${JSON.stringify(summary, null, 2)}\n`);
  writeFileSync(join(folder, 'out', 'report.xlsx'), workbook(summary));
  return summary;
}

if (process.argv[1] && import.meta.url === `file://${process.argv[1]}`) {
  const [folder, ...rest] = process.argv.slice(2);
  let period;
  const gets = [];
  for (let i = 0; i < rest.length; i++) {
    if (rest[i] === '--period') period = rest[++i];
    else if (rest[i] === '--get') gets.push(rest[++i]);
  }
  if (!folder || !period || !gets.length) {
    console.error('usage: node aggregate.mjs <folder> --period <period> --get <file> [--get <file> ...]');
    process.exit(2);
  }
  aggregate(folder, period, gets.map((path) => loadSaved(folder, path)));
}
