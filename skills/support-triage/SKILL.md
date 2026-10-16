---
name: support-triage
description: Triage support tickets. The model names an intent and a severity and quotes the ticket. A script maps those through the SLA policy and filters credentials. Use when asked to sort tickets.
titleZh: 客户支持工单分拣
---

# Support ticket triage

Circle binding: Circle 1.7.0 or newer uses the `hub` extension, `/hub login` and `hub_tool_*`. Other harnesses expose the declared remote tools through their own adapters. Former Circle extension, command and tool names are not aliases.

Intent and severity are judgement. Queue, response minutes, priority and credential redaction are a script over the pinned policy. This skill was built from `templates/judgement-gate`.

## Inputs

- `file`: ticket JSON `{tickets:[{id, subject, body?}]}`. A `severity` number on the ticket is not the judgement.
- circle-hub tools: `hub_tool_docs_get`, `hub_tool_knowledge_claim_submit`. If one is missing, say so and stop.

## 1. Read the tickets (tool)

Call `hub_tool_docs_get`, or point `savedAs` at a user-provided UTF-8 file. Keep the pointer. Do not copy a password, token or key into the contract.

## 2. Name the intent and the severity (judgement)

Write `<folder>/triage.contract.json` as in `references/contract.md`. Cover every ticket id. `intent` is a short label such as `outage`, `account-takeover`, `howto` or `access`. `severity` is `critical`, `high`, `medium` or `low`, and `quote` is the span you judged it from. Do not rewrite `references/sla-policy.json`.

## 3. Gate (script)

```
node <skill>/scripts/gate.mjs <folder> --contract <folder>/triage.contract.json --policy <skill>/references/sla-policy.json
```

The script loads the saved tickets, checks every ticket id is present, checks the quote, and maps severity and intent through the policy. It does not read a severity number off the ticket. A credential-shaped span in the original sends the ticket to `credential-hold` and the echoed text is `[redacted]`.

## 4. Emit (script)

```
node <skill>/scripts/emit.mjs <folder> --contract <folder>/triage.contract.json --policy <skill>/references/sla-policy.json
```

The script writes `out/triage.json`, `out/replies.md` and `out/kb_gaps.json`. A gap is an unlisted intent or a filtered credential.

## 5. Submit gaps (tool)

Submit each gap with `hub_tool_knowledge_claim_submit` when the array is not empty.
