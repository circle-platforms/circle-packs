---
name: employee-onboarding
description: Build an onboarding checklist, flag access requests that need approval, and answer a policy question from the manual. Use when asked to onboard someone or check an access request.
titleZh: 员工入职
---

# Employee onboarding

Circle binding: Circle 1.7.0 or newer uses the `hub` extension, `/hub login` and `hub_tool_*`. Other harnesses expose the declared remote tools through their own adapters. Former Circle extension, command and tool names are not aliases.

An access grant is not sent by this skill. The product-line hook `access-approval` blocks `beforeDispatch` when the role is not on the resource's `approvedRoles` list. Roles `employee-mail` and `employee-directory` are starter roles in the checklist script; every other role is marked `needsApproval`.

## Inputs

- Completed checklist ids and access requests, in `<folder>/checklist.json` and `<folder>/requests.json` before the script runs.
- `question`, `file`, `anchor` for the policy question.
- circle-hub tools: `hub_tool_docs_get`, `hub_tool_docs_section`. If one is missing, say so and stop.

## 1. Policy section (tool)

Call `hub_tool_docs_section` with `file` and `anchor`. Keep `savedAs`. Use `hub_tool_docs_get` only to confirm the manual path when the section call needs it.

## 2. Answer (judgement) and checklist (script)

Write `<folder>/answer.json`:

```json
{ "origin": "model", "question": "...", "answer": "one paragraph ending with [evd_...]", "quote": "verbatim text from the section" }
```

The quote must appear in the saved section. Then run:

```
node <skill>/scripts/onboard.mjs <folder> --checklist <folder>/checklist.json --requests <folder>/requests.json --section <section return> --answer <folder>/answer.json
```

The script writes `out/checklist.json`, `out/access_requests.json` and `out/policy_answer.md`. A quote that is not in the section is an error, not a softer answer.
