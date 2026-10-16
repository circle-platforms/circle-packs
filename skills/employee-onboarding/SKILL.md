---
name: employee-onboarding
description: Onboard someone from a manual. The model extracts permit and forbid rules with verbatim quotes. A script evaluates the checklist and the access requests. Use when asked to onboard someone or check an access request.
titleZh: 员工入职
---

# Employee onboarding

Circle binding: Circle 1.7.0 or newer uses the `hub` extension, `/hub login` and `hub_tool_*`. Other harnesses expose the declared remote tools through their own adapters. Former Circle extension, command and tool names are not aliases.

An access grant is not sent by this skill. The product-line hook `access-approval` blocks `beforeDispatch` when the role is not on the resource's `approvedRoles` list. Whether this run marks a request `needsApproval` is the script's evaluation of the gated rules. This skill was built from `templates/judgement-gate`.

## Inputs

- Completed checklist ids in `<folder>/checklist.json` as `{completed:["identity"]}`, and access requests in `<folder>/requests.json` as `{requests:[{person, role, system}]}`.
- `file` and `anchor` for the policy section.
- circle-hub tools: `hub_tool_docs_get`, `hub_tool_docs_section`. If one is missing, say so and stop.

## 1. Policy section (tool)

Call `hub_tool_docs_section` with `file` and `anchor`. Keep `savedAs`. Use `hub_tool_docs_get` only to confirm the manual path when the section call needs it.

## 2. Extract rules (judgement)

Write `<folder>/policy_rules.json` as in `references/contract.md`. Each rule is `permit`, `forbid`, or `downgrade`. A permit may set `minTenureMonths` when the quote states a tenure floor. A downgrade sets `grant` to the role the quote names as the replacement. `cue` is a polarity span of the quote. Do not decide the request yourself. After a person approves this file, later runs reuse it by SHA instead of extracting it again.

## 3. Gate (script)

```
node <skill>/scripts/gate.mjs <folder> --rules <folder>/policy_rules.json
```

The script refuses a quote that is not in the saved section, a role or tenure or grant that is not inside its quote, and a cue whose polarity is not the effect. The source may be a hub `docs.section` return or a user-provided UTF-8 file.

## 4. Emit (script)

```
node <skill>/scripts/emit.mjs <folder> --rules <folder>/policy_rules.json --checklist <folder>/checklist.json --requests <folder>/requests.json
```

The script writes `out/checklist.json`, `out/access_requests.json` and `out/policy_answer.md`. A downgrade grants the rule's `grant`. A permit whose `minTenureMonths` is above the request's `tenureMonths` is `tenure_short`. A forbid, or no matching rule, needs approval.
