// Pure function: multi-source JSON bytes in, an .xlsx with SUMIF formulas out.
// Zip entries are stored (method 0) so the tool imports nothing and does not read the clock.
// imports: none.
const CRC = new Uint32Array(256).map((_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});

function invalid(message: string): never {
  const error = new Error(message) as Error & { code: string };
  error.code = 'INVALID_PAYLOAD';
  throw error;
}

function crc32(bytes: Uint8Array): number {
  let c = 0xffffffff;
  for (const byte of bytes) c = CRC[(c ^ byte) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function concat(parts: Uint8Array[]): Uint8Array {
  const out = new Uint8Array(parts.reduce((sum, part) => sum + part.length, 0));
  let at = 0;
  for (const part of parts) {
    out.set(part, at);
    at += part.length;
  }
  return out;
}

export function zipStored(entries: [string, Uint8Array][]): Uint8Array {
  const locals: Uint8Array[] = [];
  const central: Uint8Array[] = [];
  let offset = 0;
  const dosDate = (1 << 5) | 1;
  for (const [name, data] of entries) {
    const file = new TextEncoder().encode(name);
    const crc = crc32(data);
    const local = new Uint8Array(30);
    const view = new DataView(local.buffer);
    view.setUint32(0, 0x04034b50, true);
    view.setUint16(4, 20, true);
    view.setUint16(6, 0x0800, true);
    view.setUint16(8, 0, true);
    view.setUint16(12, dosDate, true);
    view.setUint32(14, crc, true);
    view.setUint32(18, data.length, true);
    view.setUint32(22, data.length, true);
    view.setUint16(26, file.length, true);
    locals.push(local, file, data);
    const header = new Uint8Array(46);
    const directory = new DataView(header.buffer);
    directory.setUint32(0, 0x02014b50, true);
    directory.setUint16(4, 20, true);
    directory.setUint16(6, 20, true);
    directory.setUint16(8, 0x0800, true);
    directory.setUint16(14, dosDate, true);
    directory.setUint32(16, crc, true);
    directory.setUint32(20, data.length, true);
    directory.setUint32(24, data.length, true);
    directory.setUint16(28, file.length, true);
    directory.setUint32(42, offset, true);
    central.push(header, file);
    offset += 30 + file.length + data.length;
  }
  const directory = concat(central);
  const end = new Uint8Array(22);
  const endView = new DataView(end.buffer);
  endView.setUint32(0, 0x06054b50, true);
  endView.setUint16(8, entries.length, true);
  endView.setUint16(10, entries.length, true);
  endView.setUint32(12, directory.length, true);
  endView.setUint32(16, offset, true);
  return concat([...locals, directory, end]);
}

const escapeXml = (text: string) => text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

type Cell = string | number | { formula: string; result: number } | null;

function sheetXml(rows: Cell[][]): string {
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

export const REPORT_FORMULAS = {
  revenue: 'SUMIF(Lines!C:C,"revenue",Lines!D:D)',
  expense: 'SUMIF(Lines!C:C,"expense",Lines!D:D)',
  margin: 'B1-B2',
} as const;

export interface ReportSource {
  name: string;
  rows: { account: string; kind: 'revenue' | 'expense'; amount: number }[];
}

export interface ReportSummary {
  period: string;
  rows: { source: string; account: string; kind: string; amount: number }[];
  revenue: number;
  expense: number;
  margin: number;
  formulas: { revenue: string; expense: string; margin: string };
  origin: 'script';
}

const label = (value: string, field: string) => {
  if (!/^[\u3400-\u9fffA-Za-z0-9 ._-]{1,80}$/.test(value)) invalid(`${field} is malformed`);
  return value;
};

export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = '';
  let quoted = false;
  const pushCell = () => { row.push(cell); cell = ''; };
  const pushRow = () => { if (row.some((value) => value.trim())) rows.push(row); row = []; };
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (quoted) {
      if (ch === '"') {
        if (text[i + 1] === '"') { cell += '"'; i++; }
        else quoted = false;
      } else cell += ch;
    } else if (ch === '"') quoted = true;
    else if (ch === ',') pushCell();
    else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && text[i + 1] === '\n') i++;
      pushCell();
      pushRow();
    } else cell += ch;
  }
  if (cell.length || row.length) { pushCell(); pushRow(); }
  return rows;
}

export function rowsFromCsv(
  name: string,
  text: string,
  columns: { account: string; kind: string; amount: string },
  metrics: { kind: string; match?: string }[],
): ReportSource['rows'] {
  const table = parseCsv(text);
  if (table.length < 2) invalid('CSV has no data row');
  const headers = table[0];
  const at = (header: string) => {
    const index = headers.indexOf(header);
    if (index < 0) invalid(`Header ${header} is not in the source`);
    return index;
  };
  const accountAt = at(columns.account);
  const kindAt = at(columns.kind);
  const amountAt = at(columns.amount);
  return table.slice(1).map((line) => {
    const account = line[accountAt] ?? '';
    const rawKind = (line[kindAt] ?? '').trim();
    const amountText = (line[amountAt] ?? '').trim();
    if (amountText === '') invalid('empty_amount');
    const amount = Number(amountText);
    label(account, 'Account');
    const metric = metrics.find((item) => (item.match ?? item.kind).split('|').includes(rawKind));
    if (!metric || (metric.kind !== 'revenue' && metric.kind !== 'expense')) invalid('Kind is not an approved metric');
    if (!Number.isFinite(amount)) invalid('Amount must be a finite number');
    return { account, kind: metric.kind, amount };
  });
}

export function reconcileCsv(
  text: string,
  columns: { date: string; account: string; kind: string; amount: string },
  metrics: { kind: string; match?: string }[],
  period: string,
): { accepted: { account: string; kind: 'revenue' | 'expense'; amount: number }[]; rejected: { reason: string; amount: number | null }[]; acceptedTotal: number; reconcile: { accepted: number; rejectedNumeric: number; naivePositive: number } } {
  const table = parseCsv(text);
  if (table.length < 2) invalid('CSV has no data row');
  const headers = table[0];
  const at = (header: string) => {
    const index = headers.indexOf(header);
    if (index < 0) invalid(`Header ${header} is not in the source`);
    return index;
  };
  const dateAt = at(columns.date);
  const accountAt = at(columns.account);
  const kindAt = at(columns.kind);
  const amountAt = at(columns.amount);
  const accepted: { account: string; kind: 'revenue' | 'expense'; amount: number }[] = [];
  const rejected: { reason: string; amount: number | null }[] = [];
  for (const line of table.slice(1)) {
    const date = (line[dateAt] ?? '').trim();
    const amountText = (line[amountAt] ?? '').trim();
    const amount = /^-?\d+(\.\d+)?$/.test(amountText) ? Number(amountText) : null;
    const reject = (reason: string) => rejected.push({ reason, amount });
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) { reject('bad_date'); continue; }
    if (!date.startsWith(period)) { reject('outside_period'); continue; }
    if (amountText === '') { reject('empty_amount'); continue; }
    if (amount == null) { reject('bad_amount'); continue; }
    if (amount < 0) { reject('negative_amount'); continue; }
    const rawKind = (line[kindAt] ?? '').trim();
    const metric = metrics.find((item) => (item.match ?? item.kind).split('|').includes(rawKind));
    if (!metric || (metric.kind !== 'revenue' && metric.kind !== 'expense')) { reject('unapproved_kind'); continue; }
    label(line[accountAt] ?? '', 'Account');
    accepted.push({ account: line[accountAt] ?? '', kind: metric.kind, amount });
  }
  const acceptedTotal = accepted.reduce((sum, row) => sum + row.amount, 0);
  const rejectedNumeric = rejected.reduce((sum, row) => sum + (typeof row.amount === 'number' && row.amount > 0 ? row.amount : 0), 0);
  return { accepted, rejected, acceptedTotal, reconcile: { accepted: acceptedTotal, rejectedNumeric, naivePositive: acceptedTotal + rejectedNumeric } };
}

export function summariseReport(period: string, sources: ReportSource[]): ReportSummary {
  if (!/^[A-Za-z0-9 ._-]{1,40}$/.test(period)) invalid('Period is malformed');
  if (!Array.isArray(sources) || sources.length < 1 || sources.length > 20) invalid('Provide 1 to 20 sources');
  const rows: ReportSummary['rows'] = [];
  for (const source of sources) {
    label(source.name, 'Source name');
    if (!Array.isArray(source.rows) || source.rows.length > 2000) invalid(`Source ${source.name} rows are malformed`);
    for (const row of source.rows) {
      label(row.account, 'Account');
      if (row.kind !== 'revenue' && row.kind !== 'expense') invalid(`Kind must be revenue or expense`);
      if (typeof row.amount !== 'number' || !Number.isFinite(row.amount)) invalid('Amount must be a finite number');
      rows.push({ source: source.name, account: row.account, kind: row.kind, amount: row.amount });
    }
  }
  if (rows.length > 5000) invalid('Report rows exceed their bound');
  rows.sort((a, b) => (a.source < b.source ? -1 : a.source > b.source ? 1 : a.account < b.account ? -1 : a.account > b.account ? 1 : a.kind < b.kind ? -1 : 1));
  const revenue = rows.filter((row) => row.kind === 'revenue').reduce((sum, row) => sum + row.amount, 0);
  const expense = rows.filter((row) => row.kind === 'expense').reduce((sum, row) => sum + row.amount, 0);
  return { period, rows, revenue, expense, margin: revenue - expense, formulas: { ...REPORT_FORMULAS }, origin: 'script' };
}

export function workbookBytes(summary: ReportSummary): Uint8Array {
  const lines: Cell[][] = [['Source', 'Account', 'Kind', 'Amount'], ...summary.rows.map((row) => [row.source, row.account, row.kind, row.amount])];
  const totals: Cell[][] = [
    ['Revenue', { formula: summary.formulas.revenue, result: summary.revenue }],
    ['Expense', { formula: summary.formulas.expense, result: summary.expense }],
    ['Margin', { formula: summary.formulas.margin, result: summary.margin }],
  ];
  const encode = (text: string) => new TextEncoder().encode(text);
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

export function buildReportWorkbook(bytes: Uint8Array): { summary: ReportSummary; xlsx: Uint8Array } {
  let parsed: unknown;
  try {
    parsed = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes));
  } catch {
    invalid('Report bytes are not UTF-8 JSON');
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) invalid('Report JSON must be an object');
  const body = parsed as { period?: unknown; sources?: unknown; metrics?: { aggregate?: string; kind?: string }[] };
  if (typeof body.period !== 'string' || !Array.isArray(body.sources)) invalid('Report JSON needs period and sources');
  if (Array.isArray(body.metrics)) {
    const kinds = new Set(body.metrics.filter((metric) => metric.aggregate === 'sumif' && typeof metric.kind === 'string').map((metric) => metric.kind));
    for (const source of body.sources as { rows?: { kind?: string }[] }[]) {
      for (const row of source.rows ?? []) if (!kinds.has(row.kind)) invalid('Kind is not an approved metric');
    }
  }
  const summary = summariseReport(body.period, body.sources as ReportSource[]);
  return { summary, xlsx: workbookBytes(summary) };
}
