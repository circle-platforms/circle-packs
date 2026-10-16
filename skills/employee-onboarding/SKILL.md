---
name: employee-onboarding
description: Onboard someone from a pinned access policy. The first run extracts rules twice for a person to approve. Later runs evaluate requests against that pin. Use when asked to onboard someone or check an access request.
titleZh: 员工入职
---

# Employee onboarding

Circle binding: Circle 1.7.0 or newer uses the `hub` extension, `/hub login` and `hub_tool_*`. Other harnesses expose the declared remote tools through their own adapters. Former Circle extension, command and tool names are not aliases.

An access grant is not sent by this skill. The product-line hook `access-approval` blocks `beforeDispatch` when the role is not on the resource's `approvedRoles` list. Whether this run marks a request `needsApproval` is the script's evaluation of the pinned rules. This skill was built from `templates/judgement-gate`.

## Inputs

- Completed checklist ids in `<folder>/checklist.json` as `{completed:["identity"]}`, and access requests in `<folder>/requests.json` as `{requests:[{person, role, system, tenure:{value, unit}, startDate}]}`.
- `file` and `anchor` for the policy section, the first time that policy is pinned.
- circle-hub tools: `hub_tool_docs_get`, `hub_tool_docs_section`. If one is missing, say so and stop.

## 1. Policy section (tool)

Call `hub_tool_docs_section` with `file` and `anchor`. Keep `savedAs`. Use `hub_tool_docs_get` only to confirm the manual path when the section call needs it. A later run of an already pinned policy does not read the manual again.

## 2. Extract once, then pin (judgement, then a person)

The first time a company adopts a policy, write two files as in `references/contract.md`. Do the two passes independently.

```
node <skill>/scripts/gate.mjs <folder> --left <folder>/rules.left.json --right <folder>/rules.right.json
```

A disagreement is `needs_human` in `<folder>/compare.json`. A person resolves it and writes one file with `"origin": "approved"`. Pin that file:

```
node templates/judgement-gate/pin.mjs <approved.json> --out <pin.json> --approve
```

Later runs use those two files. They do not extract the rules again.

## 3. Gate (script)

```
node <skill>/scripts/gate.mjs <folder> --rules <approved.json> --pin <pin.json>
```

The script refuses an origin other than `approved`, a pin that does not match the bytes, a quote that is not at `offset`, a role or grant or approver that is not inside the quote, and a tenure whose unit is not the unit in the quote (`unit_mismatch`). `90天` is 90 days. It is not 90 months and it is not 3 months. The same quote used as both `permit` and `forbid` fails `polarity_conflict`. A role may contain a colon, as in `账本:只读`.

## 4. Emit (script)

```
node <skill>/scripts/emit.mjs <folder> --rules <approved.json> --checklist <folder>/checklist.json --requests <folder>/requests.json
```

The script writes `out/checklist.json`, `out/access_requests.json` and `out/policy_answer.md`. A permit whose waiting period is above the request's tenure is `tenure_short`. A downgrade whose `after` period is not yet met is `not_yet`. A met downgrade names `grant`. The grant date is the start date plus the waiting days. The approver is the span the rule quoted. A byte change of the approved file after the gate is `policy_changed_after_gate`.
