---
name: incident-postmortem
description: Label an incident log and compute MTTR. The model labels each line. A script recomputes the events, names every missing field, and computes the mean. Use when asked for a postmortem or a mean time to recover.
titleZh: 事故复盘
---

# Incident postmortem

Circle binding: Circle 1.7.0 or newer uses the `hub` extension, `/hub login` and `hub_tool_*`. Other harnesses expose the declared remote tools through their own adapters. Former Circle extension, command and tool names are not aliases.

The model labels lines. The script parses them again and computes MTTR. This skill was built from `templates/judgement-gate`.

## Inputs

- `file`: the log. One event per line, `2026-09-02T10:00:00Z inc-1 opened synthetic checkout failure`.
- circle-hub tools: `hub_tool_docs_get`, `hub_tool_knowledge_claim_submit`. If one is missing, say so and stop.

## 1. Read the log (tool)

Call `hub_tool_docs_get`. Keep `savedAs`.

## 2. Label the lines (judgement)

Write `<folder>/labels.json` as in `references/contract.md`. `quote` is one whole line. `event` and `incident` are your reading of that line. Do not invent a timestamp.

## 3. Gate (script)

```
node <skill>/scripts/gate.mjs <folder> --labels <folder>/labels.json
```

The script loads the saved log, refuses a quote that is not a whole line, parses every non-empty line, and keeps the parse when it disagrees with a label. A line that does not match is listed with `missingFields` (`timestamp`, `incident`, `event`). An incident without `opened` or `resolved` is listed with those names. It is not included in the mean.

## 4. Emit (script)

```
node <skill>/scripts/emit.mjs <folder> --labels <folder>/labels.json
```

The script writes `out/timeline.json` and `out/postmortem.md`. MTTR is the mean of `resolved - opened` in minutes over complete incidents.

## 5. Submit the MTTR (tool)

Submit one claim with `hub_tool_knowledge_claim_submit`: subject `incident-log:<path>`, predicate `mttr_minutes`, value the script's `mttrMinutes`, evidence the saved `docs.get` id. Skip it when `mttrMinutes` is null.
