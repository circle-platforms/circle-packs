---
name: contract-review
description: Review one supplier contract. The model extracts permit or forbid clauses with verbatim quotes. A script scores risk from the policy table. Use when asked to review a contract or a supplier.
titleZh: 合同与供应商评审
---

# Contract and supplier review

Circle binding: Circle 1.7.0 or newer uses the `hub` extension, `/hub login` and `hub_tool_*`. Other harnesses expose the declared remote tools through their own adapters. Former Circle extension, command and tool names are not aliases.

Judgement writes the clause contract. The gate checks quotes against the server-saved original. The policy table scores risk. This skill was built from `templates/judgement-gate`.

## Inputs

- `file`: the contract on the documents connector. Headings are `# Heading` or `1. Heading`.
- circle-hub tools: `hub_tool_docs_get`, `hub_tool_knowledge_claim_submit`. If one is missing, say so and stop.

## 1. Read the contract (tool)

Call `hub_tool_docs_get`. Keep the `savedAs` pointer. Do not paste the return into the contract.

## 2. Extract clauses (judgement)

Write `<folder>/clauses.contract.json` in the shape of `references/contract.md`. Each clause is `permit` or `forbid`, with a `value` copied from its `quote`. Do not write a risk.

## 3. Gate (script)

```
node <skill>/scripts/gate.mjs <folder> --contract <folder>/clauses.contract.json --policy <skill>/references/risk-policy.json
```

The script refuses a transcribed return, a quote that is not in that heading's section, and a value that is not inside the quote. It scores each clause from the policy table and lists required headings the source does not contain.

## 4. Emit (script)

```
node <skill>/scripts/emit.mjs <folder> --contract <folder>/clauses.contract.json
```

The script writes `out/clauses.json`, `out/review_report.md` and `out/review_claims.json`. Risk in those files is `origin: script`.

## 5. Submit claims (tool)

Submit each object in `out/review_claims.json` with `hub_tool_knowledge_claim_submit`. Skip the call when the array is empty.
