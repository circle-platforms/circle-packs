---
name: monthly-business-report
description: Aggregate approved business metrics from raw CSV into a workbook with SUMIF formulas. Two independent extracts map headers. The script filters the period and reconciles the total. Use when asked for a monthly business report.
titleZh: 月度经营报告
---

# Monthly business report

Circle binding: Circle 1.7.0 or newer uses the `hub` extension, `/hub login` and `hub_tool_*`. Other harnesses expose the declared remote tools through their own adapters. Former Circle extension, command and tool names are not aliases.

The human approves `metrics.yaml` once and the run pins its SHA. The model maps CSV headers only, twice. The script reads every data row. This skill was built from `templates/judgement-gate`.

## Inputs

- `metrics`: the approved metrics file. The sample shape is `references/metrics.sample.yaml`. Do not edit it to make a total come out. Pin it with `node templates/judgement-gate/pin.mjs`.
- `directory`: the documents directory that holds the extracts.
- circle-hub tools: `hub_tool_docs_list`, `hub_tool_docs_get`. If one is missing, say so and stop.

## 1. Choose the sources (tool + judgement)

Call `hub_tool_docs_list` on `directory`. Pick the CSV files for the period named in `metrics.yaml`. Call `hub_tool_docs_get` once per file, or point `savedAs` at a user-provided CSV in the run folder. Keep every pointer. Do not retype a row.

Each file is raw UTF-8 CSV. The first row is the header. Column names are whatever the file uses.

## 2. Map the headers twice (judgement)

Write `<folder>/headers.left.json` and `<folder>/headers.right.json` as in `references/contract.md`. Map `date`, `account`, `kind` and `amount` to header cells. Do not put cell values in the contract. Do the two passes independently. Do not edit `metrics.yaml`.

## 3. Gate (script)

```
node <skill>/scripts/gate.mjs <folder> --left <folder>/headers.left.json --right <folder>/headers.right.json --metrics <approved metrics.yaml> --pin <pin.json>
```

The script checks the pin, checks each mapped name is a header cell, and classifies every data row. A row outside the pinned period, a row with a bad date, an empty amount, a negative amount, a non-numeric amount, or a kind the metrics do not name goes to the reject list with that reason. An empty amount stays empty. It is not zero. The accepted total plus the positive rejected amounts is the naive total, so a wrong sum can be seen. Header maps that disagree are `needs_human` and no total is written.

## 4. Emit (script)

```
node <skill>/scripts/emit.mjs <folder> --left <folder>/headers.left.json --right <folder>/headers.right.json --metrics <approved metrics.yaml>
```

The script writes `<folder>/out/report.json` and `<folder>/out/report.xlsx`. Accepted rows are the workbook lines. Summary cells are formulas. For the sample metrics, `B1` is `SUMIF(Lines!C:C,"revenue",Lines!D:D)`, `B2` is the expense sum, and `B3` is `B1-B2`. A metrics byte change after the gate is `policy_changed_after_gate`. A header-map byte change is `contract_changed_after_gate`.
