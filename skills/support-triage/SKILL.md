---
name: support-triage
description: Triage support tickets. The model names an intent and quotes the ticket. A script assigns the SLA, the queue and the credential filter. Use when asked to sort tickets.
titleZh: 客户支持工单分拣
---

# Support ticket triage

Circle binding: Circle 1.7.0 or newer uses the `hub` extension, `/hub login` and `hub_tool_*`. Other harnesses expose the declared remote tools through their own adapters. Former Circle extension, command and tool names are not aliases.

Judgement is the intent. Queue, response minutes, priority and credential redaction are a script. This skill was built from `templates/judgement-gate`.

## Inputs

- `file`: ticket JSON `{tickets:[{id, subject, severity, tier, body?}]}`.
- circle-hub tools: `hub_tool_docs_get`, `hub_tool_knowledge_claim_submit`. If one is missing, say so and stop.

## 1. Read the tickets (tool)

Call `hub_tool_docs_get`. Keep `savedAs`. Do not copy a password, token or key into the contract.

## 2. Name the intent (judgement)

Write `<folder>/triage.contract.json` as in `references/contract.md`. `intent` is a short label such as `outage`, `howto` or `access`. `quote` is verbatim from that ticket.

## 3. Gate (script)

```
node <skill>/scripts/gate.mjs <folder> --contract <folder>/triage.contract.json --policy <skill>/references/sla-policy.json
```

The script loads the saved tickets, checks the quote, recomputes priority from severity and tier, and routes from the policy table. A credential-shaped span in the original sends the ticket to `credential-hold` and the echoed text is `[redacted]`.

## 4. Emit (script)

```
node <skill>/scripts/emit.mjs <folder> --contract <folder>/triage.contract.json
```

The script writes `out/triage.json`, `out/replies.md` and `out/kb_gaps.json`. A gap is an unlisted intent or a filtered credential.

## 5. Submit gaps (tool)

Submit each gap with `hub_tool_knowledge_claim_submit` when the array is not empty.
