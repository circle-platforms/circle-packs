---
name: monthly-business-report
description: Aggregate several business extracts into one workbook with SUMIF formulas. Use when asked for a monthly business report from uploaded sources.
titleZh: 月度经营报告
---

# Monthly business report

Circle binding: Circle 1.7.0 or newer uses the `hub` extension, `/hub login` and `hub_tool_*`. Other harnesses expose the declared remote tools through their own adapters. Former Circle extension, command and tool names are not aliases.

## Inputs

- `period`: for example `2026-09`.
- `directory`: the documents directory that holds the extracts.
- circle-hub tools: `hub_tool_docs_list`, `hub_tool_docs_get`. If one is missing, say so and stop.

## 1. Choose the sources (tool + judgement)

Call `hub_tool_docs_list` on `directory`. Pick the extract files for this period. Call `hub_tool_docs_get` once per file. Keep every `savedAs` pointer. Do not retype the rows.

Each file is UTF-8 JSON `{name, rows:[{account, kind, amount}]}`. `kind` is `revenue` or `expense`.

## 2. Aggregate (script)

```
node <skill>/scripts/aggregate.mjs <folder> --period <period> --get <return> [--get <return> ...]
```

The script writes `<folder>/out/report.json` and `<folder>/out/report.xlsx`.

The workbook has two sheets. `Lines` holds one row per source row. `Summary` holds formulas, not typed totals:

- `B1` = `SUMIF(Lines!C:C,"revenue",Lines!D:D)`
- `B2` = `SUMIF(Lines!C:C,"expense",Lines!D:D)`
- `B3` = `B1-B2`

The cached numbers next to those formulas are the same sums the script computed. A row whose kind is neither revenue nor expense stops the script.
