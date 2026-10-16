---
name: incident-postmortem
description: Label an incident log and compute two durations. Two independent extracts label each line. A script checks quotes, zones and the pinned metric definitions. Use when asked for a postmortem.
titleZh: 事故复盘
---

# Incident postmortem

Circle binding: Circle 1.7.0 or newer uses the `hub` extension, `/hub login` and `hub_tool_*`. Other harnesses expose the declared remote tools through their own adapters. Former Circle extension, command and tool names are not aliases.

The model labels lines twice, independently. The script checks each quote at its offset, requires a timezone, and computes the pinned metrics only where the two files agree. This skill was built from `templates/judgement-gate`.

## Inputs

- `file`: the log, one event per line. A chat line may carry `JST`, `CST`, `Z`, or `+08:00`. A line with a clock and no date takes the date from an earlier line, and the script records that assumption.
- circle-hub tools: `hub_tool_docs_get`, `hub_tool_knowledge_claim_submit`. If one is missing, say so and stop.

## 1. Read the log (tool)

Call `hub_tool_docs_get`, or point `savedAs` at a user-provided UTF-8 file in the run folder. Keep the pointer.

## 2. Label the lines twice (judgement)

Write `<folder>/labels.left.json` and `<folder>/labels.right.json` as in `references/contract.md`. Do the two passes independently. `quote` is one whole line. `at` is a span of that line. An incident id is optional and does not have to appear in the line. `event` may be `other`. A clock with no date sets `dateFrom` to an earlier `YYYY-MM-DD` line. Do not invent a timestamp, and do not assume UTC. Do not rewrite `references/incident-policy.json`.

## 3. Gate (script)

```
node <skill>/scripts/gate.mjs <folder> --left <folder>/labels.left.json --right <folder>/labels.right.json --policy <skill>/references/incident-policy.json --pin <skill>/references/incident-policy.pin.json
```

The script refuses a quote that is not at `offset`, a timestamp with no zone (`zone_missing`), a dateless clock with no earlier date (`date_missing`), a repeated incident event (`duplicate_label`), and a line with no label. Where the extracts agree, it reports `alert` (opened to resolved) and `customerImpact` (impact start to impact end) separately. A disagreement is `needs_human` and no duration is chosen. A metric the agreed labels cannot fill fails with `metrics_missing`.

## 4. Emit (script)

```
node <skill>/scripts/emit.mjs <folder> --left <folder>/labels.left.json --right <folder>/labels.right.json --policy <skill>/references/incident-policy.json
```

The script writes `out/timeline.json` and `out/postmortem.md`. A policy byte change after the gate is `policy_changed_after_gate`.

## 5. Submit the durations (tool)

Submit one claim per metric with `hub_tool_knowledge_claim_submit`: subject `incident-log:<path>`, predicate the metric id, value the script's minutes. Skip a metric that is `needs_human`.
