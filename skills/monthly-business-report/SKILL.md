---
name: monthly-business-report
description: Aggregate approved business metrics from several extracts into a workbook with SUMIF formulas. The metric list is a human-approved metrics.yaml. Use when asked for a monthly business report.
titleZh: 月度经营报告
---

# Monthly business report

Circle binding: Circle 1.7.0 or newer uses the `hub` extension, `/hub login` and `hub_tool_*`. Other harnesses expose the declared remote tools through their own adapters. Former Circle extension, command and tool names are not aliases.

The human approves `metrics.yaml` once and the run pins its SHA. The model maps CSV headers only. The script reads every data row. This skill was built from `templates/judgement-gate`.

## Inputs

- `metrics`: the approved metrics file. The sample shape is `references/metrics.sample.yaml`. Do not edit it to make a total come out.
- `directory`: the documents directory that holds the extracts.
- circle-hub tools: `hub_tool_docs_list`, `hub_tool_docs_get`. If one is missing, say so and stop.

## 1. Choose the sources (tool + judgement)

Call `hub_tool_docs_list` on `directory`. Pick the CSV files for the period named in `metrics.yaml`. Call `hub_tool_docs_get` once per file, or point `savedAs` at a user-provided CSV in the run folder. Keep every pointer. Do not retype a row.

Each file is raw UTF-8 CSV. The first row is the header.

## 2. Map the headers (judgement)

Write `<folder>/sources.contract.json` as in `references/contract.md`. `columns` names the header cells for account, kind and amount. Do not put cell values in the contract. Do not edit `metrics.yaml` to make a total come out.

## 3. Gate (script)

```
node <skill>/scripts/gate.mjs <folder> --contract <folder>/sources.contract.json --metrics <approved metrics.yaml>
```

The script checks the metrics schema, checks each mapped name is a header cell, parses every data row, and sums only approved kinds. `收入` matches `revenue` when the pinned metrics say so.

## 4. Emit (script)

```
node <skill>/scripts/emit.mjs <folder> --contract <folder>/sources.contract.json --metrics <approved metrics.yaml>
```

The script writes `<folder>/out/report.json` and `<folder>/out/report.xlsx`. Summary cells are formulas. For the sample metrics, `B1` is `SUMIF(Lines!C:C,"revenue",Lines!D:D)`, `B2` is the expense sum, and `B3` is `B1-B2`.
