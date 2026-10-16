#!/usr/bin/env node
// Aggregate approved metrics from server-saved extracts. The zip is stored, method 0.
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { assertExactKeys, assertOriginModel, assertPointer, loadPointedReturn, readJson, sha256, utf8FromBase64 } from './pointers.mjs';

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

const label = (value, field) => {
  if (typeof value !== 'string' || !/^[A-Za-z0-9 ._-]{1,80}$/.test(value)) throw new Error(`${field} is malformed`);
  return value;
};
const scalar = (raw) => {
  const text = raw.trim();
  if (text.startsWith('"') && text.endsWith('"')) return JSON.parse(text);
  return text;
};

export function parseMetricsYaml(text) {
  const root = { metrics: [] };
  let current = null;
  for (const line of text.split('\n')) {
    if (!line.trim() || line.trim().startsWith('#')) continue;
    const indent = line.match(/^ */)[0].length;
    const body = line.trim();
    if (indent === 0 && body === 'metrics:') continue;
    if (indent === 0) {
      const match = /^([A-Za-z]+): (.*)$/.exec(body);
      if (!match) throw new Error('schema_invalid: metrics yaml');
      root[match[1]] = scalar(match[2]);
    } else if (indent === 2 && body.startsWith('- ')) {
      current = {};
      root.metrics.push(current);
      const match = /^([A-Za-z]+): (.*)$/.exec(body.slice(2));
      if (!match) throw new Error('schema_invalid: metric item');
      current[match[1]] = scalar(match[2]);
    } else if (indent === 4 && current) {
      const match = /^([A-Za-z]+): (.*)$/.exec(body);
      if (!match) throw new Error('schema_invalid: metric field');
      current[match[1]] = scalar(match[2]);
    } else throw new Error('schema_invalid: metrics yaml');
  }
  return root;
}

export function planMetrics(metrics) {
  if (metrics.schema !== 'enterprise/metrics/1') throw new Error('schema_invalid: metrics schema');
  if (typeof metrics.period !== 'string' || !/^[A-Za-z0-9 ._-]{1,40}$/.test(metrics.period)) throw new Error('schema_invalid: period');
  const sumif = [];
  let difference = null;
  for (const item of metrics.metrics ?? []) {
    if (item.aggregate === 'sumif') {
      if (typeof item.id !== 'string' || typeof item.kind !== 'string') throw new Error('schema_invalid: sumif');
      if (sumif.some((row) => row.id === item.id || row.kind === item.kind)) throw new Error('schema_invalid: duplicate metric');
      sumif.push(item);
    } else if (item.aggregate === 'difference') {
      if (difference) throw new Error('schema_invalid: one difference');
      difference = item;
    } else throw new Error('schema_invalid: aggregate');
  }
  if (!sumif.length || !difference) throw new Error('schema_invalid: metrics need a sum and a difference');
  if (!sumif.some((row) => row.id === difference.left) || !sumif.some((row) => row.id === difference.right)) throw new Error('schema_invalid: difference names');
  return { period: metrics.period, sumif, difference };
}

export function summarise(plan, sources) {
  const allowed = new Set(plan.sumif.map((metric) => metric.kind));
  const rows = [];
  for (const source of sources) {
    label(source.name, 'source name');
    for (const row of source.rows ?? []) {
      label(row.account, 'account');
      if (!allowed.has(row.kind)) throw new Error('kind is not an approved metric');
      if (typeof row.amount !== 'number' || !Number.isFinite(row.amount)) throw new Error('amount must be a finite number');
      rows.push({ source: source.name, account: row.account, kind: row.kind, amount: row.amount });
    }
  }
  rows.sort((a, b) => (a.source < b.source ? -1 : a.source > b.source ? 1 : a.account < b.account ? -1 : a.account > b.account ? 1 : a.kind < b.kind ? -1 : 1));
  const sums = plan.sumif.map((metric) => ({
    id: metric.id,
    formula: `SUMIF(Lines!C:C,"${metric.kind}",Lines!D:D)`,
    result: rows.filter((row) => row.kind === metric.kind).reduce((sum, row) => sum + row.amount, 0),
  }));
  const left = sums.findIndex((row) => row.id === plan.difference.left) + 1;
  const right = sums.findIndex((row) => row.id === plan.difference.right) + 1;
  const margin = sums.find((row) => row.id === plan.difference.left).result - sums.find((row) => row.id === plan.difference.right).result;
  const totals = [...sums, { id: plan.difference.id, formula: `B${left}-B${right}`, result: margin }];
  return {
    period: plan.period,
    rows,
    totals,
    revenue: sums.find((row) => row.id === 'revenue')?.result ?? null,
    expense: sums.find((row) => row.id === 'expense')?.result ?? null,
    margin,
    formulas: { revenue: FORMULAS.revenue, expense: FORMULAS.expense, margin: FORMULAS.margin },
    origin: 'script',
  };
}

export function workbook(summary) {
  const lines = [['Source', 'Account', 'Kind', 'Amount'], ...summary.rows.map((row) => [row.source, row.account, row.kind, row.amount])];
  const totals = summary.totals.map((total) => [total.id, { formula: total.formula, result: total.result }]);
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

export function gateReport(folder, contractPath, metricsPath) {
  const contractBytes = readFileSync(contractPath);
  const metricsBytes = readFileSync(metricsPath);
  const contract = readJson(contractPath);
  assertExactKeys(contract, ['origin', 'schema', 'sources'], 'sources contract');
  assertOriginModel(contract, 'sources contract');
  if (contract.schema !== 'enterprise/sources/1' || !Array.isArray(contract.sources) || !contract.sources.length) throw new Error('schema_invalid: sources');
  const plan = planMetrics(parseMetricsYaml(metricsBytes.toString('utf8')));
  const sources = contract.sources.map((source, index) => {
    assertPointer(source, `source ${index}`);
    const saved = loadPointedReturn(folder, source, `source ${index}`);
    const parsed = JSON.parse(utf8FromBase64(saved.result));
    return { name: parsed.name, rows: parsed.rows, evidenceId: saved.evidenceId };
  });
  const summary = summarise(plan, sources);
  const gate = { ok: true, origin: 'script', contractSha256: sha256(contractBytes), metricsSha256: sha256(metricsBytes), summary };
  writeFileSync(join(folder, 'gate.json'), `${JSON.stringify(gate, null, 2)}\n`);
  return gate;
}

export function emitReport(folder, contractPath, metricsPath) {
  const gate = readJson(join(folder, 'gate.json'));
  if (gate?.ok !== true) throw new Error('gate_not_passed');
  if (sha256(readFileSync(contractPath)) !== gate.contractSha256 || sha256(readFileSync(metricsPath)) !== gate.metricsSha256) throw new Error('contract_changed_after_gate');
  mkdirSync(join(folder, 'out'), { recursive: true });
  writeFileSync(join(folder, 'out', 'report.json'), `${JSON.stringify(gate.summary, null, 2)}\n`);
  writeFileSync(join(folder, 'out', 'report.xlsx'), workbook(gate.summary));
  return gate.summary;
}
