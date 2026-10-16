---
name: incident-postmortem
description: Turn an incident log into a timeline and an MTTR figure, then attach a model narrative. Use when asked for a postmortem or a mean time to recover.
titleZh: 事故复盘
---

# Incident postmortem

Circle binding: Circle 1.7.0 or newer uses the `hub` extension, `/hub login` and `hub_tool_*`. Other harnesses expose the declared remote tools through their own adapters. Former Circle extension, command and tool names are not aliases.

## Inputs

- `file`: the log. One event per line, `2026-09-02T10:00:00Z inc-1 opened synthetic checkout failure`.
- circle-hub tools: `hub_tool_docs_get`, `hub_tool_knowledge_claim_submit`. If one is missing, say so and stop.

## 1. Read the log (tool)

Call `hub_tool_docs_get`. Keep `savedAs`.

## 2. Timeline (script) and narrative (judgement)

Write `<folder>/narrative.json` as `{ "origin": "model", "text": "one paragraph" }`. Do not invent times. Then run:

```
node <skill>/scripts/timeline.mjs <folder> --get <hub-saved return> --narrative <folder>/narrative.json
```

The script writes `out/timeline.json` and `out/postmortem.md`. MTTR is the mean of `resolved - opened` in minutes. An incident with either mark missing is listed as incomplete and is not included in the mean.

## 3. Submit the MTTR (tool)

Submit one claim with `hub_tool_knowledge_claim_submit`: subject `incident-log:<path>`, predicate `mttr_minutes`, value the script's `mttrMinutes`, evidence the saved `docs.get` id. Skip it when `mttrMinutes` is null.
