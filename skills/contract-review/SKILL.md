---
name: contract-review
description: Review one supplier contract from a hub document. The script splits clauses and lists missing required headings; the model judges risk. Use when asked to review a contract or a supplier.
titleZh: 合同与供应商评审
---

# Contract and supplier review

Circle binding: Circle 1.7.0 or newer uses the `hub` extension, `/hub login` and `hub_tool_*`. Other harnesses expose the declared remote tools through their own adapters. Former Circle extension, command and tool names are not aliases.

## Inputs

- `file`: the contract on the documents connector. Headings are `# Heading` or `1. Heading`.
- circle-hub tools: `hub_tool_docs_get`, `hub_tool_knowledge_claim_submit`. If one is missing, say so and stop.

## 1. Read the contract (tool)

Call `hub_tool_docs_get`. Keep the `savedAs` pointer. Do not paste the contract into the chat.

## 2. Split clauses (script) after the risk notes (judgement)

Write `<folder>/review.json` as model judgement:

```json
{ "origin": "model", "findings": [{ "clauseId": "c1", "risk": "low", "note": "one sentence" }] }
```

`origin` must be `model`. Do not invent a heading the text does not have. Then run:

```
node <skill>/scripts/clauses.mjs <folder> --get <hub-saved docs.get return> --review <folder>/review.json
```

The script writes `out/clauses.json`, `out/review_report.md` and `out/review_claims.json`. A required heading that is absent (Payment terms, Termination, Liability, Data protection) is a gap of `origin: script`. Findings are copied from `review.json` and stay `origin: model`.

## 3. Submit claims (tool)

Submit each object in `out/review_claims.json` with `hub_tool_knowledge_claim_submit`. The evidence id is the one on the saved `docs.get` return. Skip the call when the claims array is empty.
