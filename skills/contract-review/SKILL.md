---
name: contract-review
description: Review one supplier contract. Two independent extracts quote each clause. A script checks offsets, adjacency and pinned numbers, and escalates a disagreement. Use when asked to review a contract or a supplier.
titleZh: 合同与供应商评审
---

# Contract and supplier review

Circle binding: Circle 1.7.0 or newer uses the `hub` extension, `/hub login` and `hub_tool_*`. Other harnesses expose the declared remote tools through their own adapters. Former Circle extension, command and tool names are not aliases.

Judgement writes two clause files, independently. The gate checks what has one right answer: the quote is at that offset, a cue sits inside the quote and next to the cited predicate, and a number parses. Risk comes from the pinned policy only where the two files agree. A disagreement is `needs_human`. This skill was built from `templates/judgement-gate`.

## Inputs

- `file`: the contract on the documents connector, or a user-provided UTF-8 file in the run folder. A heading is `# Heading`, `1. Heading`, `1、Heading`, or `第N条`. A short title after `第N条` is the heading. A one-line article with no short title keeps the heading `第N条` and the sentence as the body. `第N条 标题：正文` uses `标题`.
- circle-hub tools: `hub_tool_docs_get`, `hub_tool_knowledge_claim_submit`. If one is missing, say so and stop.

## 1. Read the contract (tool)

Call `hub_tool_docs_get` when the contract is on the connector. Keep the `savedAs` pointer. A file the user placed in the run folder uses that relative path as `savedAs`. Do not paste the return into the contract.

## 2. Extract clauses twice (judgement)

Write `<folder>/clauses.left.json` and `<folder>/clauses.right.json` in the shape of `references/contract.md`. Do the two passes independently. Do not copy one file into the other, and do not ask a model to reconcile them. `kind` is `permit`, `forbid`, `obligation`, `term` or `definition`. Polarity is optional: a term, an obligation or a definition does not need a cue. When you do cite a cue, also cite the predicate it sits next to. `offset` is the quote's index in the original. Do not write a risk. Do not rewrite `references/risk-policy.json`.

## 3. Gate (script)

```
node <skill>/scripts/gate.mjs <folder> --left <folder>/clauses.left.json --right <folder>/clauses.right.json --policy <skill>/references/risk-policy.json --pin <skill>/references/risk-policy.pin.json
```

The script refuses a quote that is not at `offset`, a cue that is not inside the quote or not adjacent to the cited predicate, a heading the file skipped, an unapproved pin, and a policy whose SHA is not the pin. It does not decide what a cue means. Where the two files agree, a payment term in days is scored from the pinned `minDays` (the sample is 30). A month is not compared with that day floor. A heading that matches no topic is `unmatched` with risk left unset. A kind or a term quantity the two files do not share is `needs_human`, with no risk chosen.

## 4. Emit (script)

```
node <skill>/scripts/emit.mjs <folder> --left <folder>/clauses.left.json --right <folder>/clauses.right.json --policy <skill>/references/risk-policy.json
```

The script writes `out/clauses.json`, `out/review_report.md` and `out/review_claims.json`. A `needs_human` row is named and is not given a risk. A policy byte change after the gate is `policy_changed_after_gate`. An extract byte change is `contract_changed_after_gate`.

## 5. Submit claims (tool)

Submit each object in `out/review_claims.json` with `hub_tool_knowledge_claim_submit`. Skip the call when the array is empty. A `needs_human` claim waits for a person.
