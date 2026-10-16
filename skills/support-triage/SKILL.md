---
name: support-triage
description: Triage support tickets. Two independent extracts name intent and severity. A script maps the agreed pair through the SLA policy, applies a security floor, and filters credentials. Use when asked to sort tickets.
titleZh: 客户支持工单分拣
---

# Support ticket triage

Circle binding: Circle 1.7.0 or newer uses the `hub` extension, `/hub login` and `hub_tool_*`. Other harnesses expose the declared remote tools through their own adapters. Former Circle extension, command and tool names are not aliases.

Intent and severity are two independent judgements. Queue, response minutes, the security floor and credential redaction are a script over the pinned policy. This skill was built from `templates/judgement-gate`.

## Inputs

- `file`: ticket JSON `{tickets:[{id, subject, body?}]}` or a raw `{text}` ticket. A `severity` number on the ticket is not the judgement.
- circle-hub tools: `hub_tool_docs_get`, `hub_tool_knowledge_claim_submit`. If one is missing, say so and stop.

## 1. Read the tickets (tool)

Call `hub_tool_docs_get`, or point `savedAs` at a user-provided UTF-8 file. Keep the pointer. Do not copy a password, token or key into the contract.

## 2. Name the intent and the severity twice (judgement)

Write `<folder>/triage.left.json` and `<folder>/triage.right.json` as in `references/contract.md`. Do the two passes independently. Cover every ticket id. A raw `{text}` file is the single id `text`. `severity` is `critical`, `high`, `medium` or `low`. `quote` is the span you judged, and `offset` is its index in that ticket's text. Do not rewrite `references/sla-policy.json`.

## 3. Gate (script)

```
node <skill>/scripts/gate.mjs <folder> --left <folder>/triage.left.json --right <folder>/triage.right.json --policy <skill>/references/sla-policy.json --pin <skill>/references/sla-policy.pin.json
```

The script checks every ticket id, checks the quote at `offset`, and maps an agreed intent through the policy. An intent the two files do not share, or a severity they do not share, is `needs_human` with no priority and no minute count. An intent that is not in the policy is `needs_human` as well. It is not given the low default. A security intent whose agreed severity is below `floors` is raised, and both the judged severity and the floor are recorded. A credential-shaped span sends the ticket to `credential-hold` and the echoed text is `[redacted]`.

## 4. Emit (script)

```
node <skill>/scripts/emit.mjs <folder> --left <folder>/triage.left.json --right <folder>/triage.right.json --policy <skill>/references/sla-policy.json
```

The script writes `out/triage.json`, `out/replies.md` and `out/kb_gaps.json`. A `needs_human` section does not name a priority or a minute count. A policy byte change after the gate is `policy_changed_after_gate`.

## 5. Submit gaps (tool)

Submit each gap with `hub_tool_knowledge_claim_submit` when the array is not empty.
