---
name: support-triage
description: Triage support tickets, draft replies from the knowledge base, and record gaps. Use when asked to sort tickets or draft a customer reply.
titleZh: 客户支持工单分拣
---

# Support ticket triage

Circle binding: Circle 1.7.0 or newer uses the `hub` extension, `/hub login` and `hub_tool_*`. Other harnesses expose the declared remote tools through their own adapters. Former Circle extension, command and tool names are not aliases.

## Inputs

- `file`: ticket JSON `{tickets:[{id, subject, severity, tier}]}`.
- circle-hub tools: `hub_tool_docs_get`, `hub_tool_docs_search`, `hub_tool_docs_section`, `hub_tool_knowledge_claim_submit`. If one is missing, say so and stop.

## 1. Read the tickets (tool)

Call `hub_tool_docs_get` for the ticket file. Keep `savedAs`.

## 2. Priority (script) and replies (judgement)

Priority is not your decision. Severity 1, or severity 2 on tier `contract`, is P1. Severity 2, or tier `priority`, is P2. Severity 3 is P3. Anything else is P4.

Search the knowledge base with `hub_tool_docs_search`, then read the section with `hub_tool_docs_section`. Write `<folder>/replies.json`:

```json
{ "replies": [{ "ticketId": "t-1", "body": "one short reply", "origin": "model", "quote": "verbatim section text or empty", "evidenceId": "evd_..." }] }
```

`origin` is `model`. `quote` is empty when the section does not contain the answer. Then run:

```
node <skill>/scripts/triage.mjs <folder> --get <tickets return> --section <section return> --replies <folder>/replies.json
```

The script writes `out/triage.json`, `out/replies.md` and `out/kb_gaps.json`. A reply whose quote is not in the saved section becomes a gap. Do not fill a gap from memory.

## 3. Submit gaps (tool)

Submit each gap with `hub_tool_knowledge_claim_submit` when the array is not empty.
