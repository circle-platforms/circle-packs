# Enterprise product line

General-purpose packs for a circle-hub that already has the documents connector and the shared knowledge tools. Synthetic samples only. Nothing here is a result on a real contract, ledger, ticket queue or incident.

## Adaptation sheet

| Object | Answer |
|---|---|
| B which systems are read | One connector: `documents` (alias `docs`). Knowledge tools stay the shared `knowledge` alias. `connectors/documents.json` has the declaration shape and no address. |
| B which originals are uploaded | `sources/contract.md`, `sources/business-extract.md`, `sources/ticket.md`, `sources/policy.md`, `sources/incident-log.md`. Uploaded at run time, with a SHA, after approval. |
| B what evidence is produced | Skill outputs listed below. Risk, totals, routes, access decisions and MTTR are `origin: script`. Clause quotes, source pointers, ticket intents, policy rules and log labels are `origin: model`, and each quote is checked against the saved original. |
| C which flows | Five: `flows/supplier-review.json`, `flows/monthly-report.json`, `flows/ticket-triage.json`, `flows/employee-onboarding.json`, `flows/incident-postmortem.json`. |
| C what needs an independent reviewer | Change sets only (registration, modification, approval). A run is not approved. An access grant is a change: the hook blocks it unless the role is on the declared list. |
| C which identities | Roles in the scope policy. The access desk does not use a machine credential. |
| D which resources | `resources/access-desk.json`. It is a declaration, not a remote connector. `approvedRoles` is filled at registration and is not in Git. |
| D how credentials are supplied | The documents connector uses whatever credential mode the administrator registers. This pack stores none. |
| D what counts as unknown | A CSV row the period filter rejects, an incident metric the agreed labels cannot fill, a ticket intent the policy does not name, or an access role no pinned rule covers. The script names it and does not invent a value. |
| E which skill steps are scripts | See each `skills/<id>/SKILL.md`. Scripts live in that skill's `scripts/` and do not import this product line. |
| E what the manifest declares | This file's sibling `product-line.json`: connector package, aliases, knowledge mappings, tools, the access hook, flows, the access-desk resource. |
| E which hooks | `hooks/access-approval.ts` on `beforeDispatch`, order 10. Codes: `ACCESS_ROLES_UNDECLARED`, `ACCESS_ROLE_MISSING`, `ACCESS_ROLE_UNAPPROVED`. Any other dispatch passes. |
| A what the user sees in Circle | `hub_tool_docs_*` and `hub_tool_knowledge_claim_submit`, plus the skill outputs. No new interface. |

## Skills

| Skill | What the script does | What the model does |
|---|---|---|
| [contract-review](../../skills/contract-review/SKILL.md) | Scores an agreed term from the pinned day floor, and reports an unmatched heading with no default risk | Extracts every heading twice, including a one-line `第N条`, with a kind and an offset |
| [monthly-business-report](../../skills/monthly-business-report/SKILL.md) | Parses raw CSV into `report.xlsx`, rejects rows outside the period, and reconciles the total | Maps header cells only, twice. The metric list is a human-approved `metrics.yaml` |
| [support-triage](../../skills/support-triage/SKILL.md) | Applies the pinned severity floor, assigns the queue, and filters credentials | Names intent and severity twice and quotes every ticket, including a raw `{text}` ticket |
| [employee-onboarding](../../skills/employee-onboarding/SKILL.md) | Applies the pinned tenure and downgrade rules and writes the approver and grant date | The first run extracts rules twice. Later runs do not extract them again |
| [incident-postmortem](../../skills/incident-postmortem/SKILL.md) | Converts zoned timestamps and reports alert duration and customer impact separately | Labels each log line twice. A line need not carry an incident id |
| [local-script](../../skills/local-script/SKILL.md) | Counts lines and words in one document | Nothing. This is the manifest example |

## Acceptance notes

- The hub core is unchanged. Product names appear in this pack's manifest, modules and data.
- Tool implementations are pure functions. They import nothing from the hub dependency set. Hashing is not required here; the monthly workbook is a stored zip with a fixed timestamp.
- The access hook blocks only an access grant that is provably outside the declared role list.
- Tests use synthetic labels (`example-supplier`, `2026-09`, `inc-1`). They do not show a result on a real system.

Installing the module and turning the tools on are different steps. See [Install on a dev:stack hub](../../docs/enterprise-packs.md).
