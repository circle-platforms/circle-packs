---
name: incident-postmortem
description: Label an incident log and compute MTTR. The model labels each line. A script checks the quotes, converts mixed timezones, and computes the mean from the pinned start and end events. Use when asked for a postmortem or a mean time to recover.
titleZh: 事故复盘
---

# Incident postmortem

Circle binding: Circle 1.7.0 or newer uses the `hub` extension, `/hub login` and `hub_tool_*`. Other harnesses expose the declared remote tools through their own adapters. Former Circle extension, command and tool names are not aliases.

The model labels lines. The script uses those labels after checking each quote, incident id and timestamp against the original. It does not parse a fixed grammar over the line. This skill was built from `templates/judgement-gate`.

## Inputs

- `file`: the log, one event per line. A chat line may carry JST, CST, `Z`, or `+08:00`.
- circle-hub tools: `hub_tool_docs_get`, `hub_tool_knowledge_claim_submit`. If one is missing, say so and stop.

## 1. Read the log (tool)

Call `hub_tool_docs_get`, or point `savedAs` at a user-provided UTF-8 file in the run folder. Keep the pointer.

## 2. Label the lines (judgement)

Write `<folder>/labels.json` as in `references/contract.md`. One label per non-empty line. `quote` is that whole line. `incident` and `at` are spans of the quote. `event` is your label. Do not invent a timestamp that is not in the line. Do not rewrite `references/incident-policy.json`. Which event starts and ends the clock is approved once and SHA-pinned.

## 3. Gate (script)

```
node <skill>/scripts/gate.mjs <folder> --labels <folder>/labels.json --policy <skill>/references/incident-policy.json
```

The script refuses a quote that is not a whole line, a timestamp or incident id that is not inside that quote, and a line with no label. It converts each `at` to UTC, including `JST`. If any incident is missing the pinned start or end event, the gate fails with `metrics_missing` and those field names. It does not write `gate.json` with `ok: true` in that case.

## 4. Emit (script)

```
node <skill>/scripts/emit.mjs <folder> --labels <folder>/labels.json --policy <skill>/references/incident-policy.json
```

The script writes `out/timeline.json` and `out/postmortem.md`. MTTR is the mean of `end - start` in minutes. Emit runs only after the gate passed, so the mean is present.

## 5. Submit the MTTR (tool)

Submit one claim with `hub_tool_knowledge_claim_submit`: subject `incident-log:<path>`, predicate `mttr_minutes`, value the script's `mttrMinutes`, evidence the saved `docs.get` id.
