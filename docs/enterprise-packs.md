---
nav_order: 5
---

# Enterprise packs

These modules are general-purpose and synthetic. They do not describe a real supplier, ledger, ticket queue, employee or incident.

| Module | Kind | Version | What it does |
|---|---|---|---|
| [products/enterprise](../products/enterprise/README.md) | product-line | 1.1.0 | Documents connector, five flows, five pure tools, one access-approval hook |
| [skills/contract-review](../skills/contract-review/SKILL.md) | skill-pack | 1.1.0 | Model extracts permit/forbid clauses; a policy table scores risk |
| [skills/monthly-business-report](../skills/monthly-business-report/SKILL.md) | skill-pack | 1.1.0 | Human-approved metrics.yaml; the script aggregates into `report.xlsx` |
| [skills/support-triage](../skills/support-triage/SKILL.md) | skill-pack | 1.1.0 | Model names intent; the script assigns SLA, queue and the credential filter |
| [skills/employee-onboarding](../skills/employee-onboarding/SKILL.md) | skill-pack | 1.1.0 | Model extracts policy rules; the script evaluates requests |
| [skills/incident-postmortem](../skills/incident-postmortem/SKILL.md) | skill-pack | 1.1.0 | Model labels log lines; the script computes MTTR and names missing fields |
| [skills/local-script](../skills/local-script/SKILL.md) | skill-pack | 1.0.0 | Worked example of a local script, its manifest and a sample trial record |

`skillpack.json` titles are English. Chinese titles are the `titleZh` field in each `SKILL.md` frontmatter, and `title` plus `titleZh` on each enterprise flow file. See [Local script example](local-script.md) for why the manifest itself cannot carry `titleZh`.

Each of those five skills follows the [judgement-gate template](judgement-gate.md): the model writes a schema'd file of verbatim quotes and source pointers, then a script checks the quotes against the server-saved original, recomputes the decision, and emits. Scaffold another skill with `node templates/judgement-gate/generate.mjs`.

The monthly workbook is a stored zip (compression method 0) so the product tool imports nothing. For the sample metrics, summary cell `B1` is `SUMIF(Lines!C:C,"revenue",Lines!D:D)`, `B2` is the same for `expense`, and `B3` is `B1-B2`. The incident tool's MTTR is the mean of `(resolved - opened) / 60000` over complete incidents, and a line or incident that cannot be used is reported with `missingFields`. The access hook on `beforeDispatch` blocks an `access-grant` whose role is missing or not on `approvedRoles`, and passes every other dispatch.

## Install on a dev:stack hub

Installation is circle-hub's own command. A catalogue check does not approve a module, and installing a product line does not switch on its tools.

1. In a circle-hub checkout run `npm run dev:stack`. The process prints one JSON object whose `type` is `dev-stack-ready`, then the address, a `POST /v1/auth/dev-login` line for user `developer` with a password chosen for that process, the scope `scp_lab`, and a separate approver login. The password is new each run. Ctrl+C stops the stack and deletes that temporary database.
2. Log in as `developer` and keep the token for the commands below. Set `CIRCLE_HUB_URL` to the printed address, `CIRCLE_HUB_TOKEN` or `CIRCLE_HUB_TOKEN_FILE` to the token, and `CIRCLE_HUB_SCOPE=scp_lab` (or pass `--scope scp_lab`). The approver is a different user. The person who submits a module does not approve it.
3. From the circle-hub checkout, point `--catalog` at this repository's `modules.json`.

Check one module, then install it:

```sh
node apps/server/src/cli.ts modules check --catalog ../circle-packs/modules.json --module local-script
node apps/server/src/cli.ts modules install \
  --catalog ../circle-packs/modules.json \
  --module local-script \
  --scope scp_lab \
  --trial ../circle-packs/skills/local-script/references/trial.json
```

A skill install requires `--trial`. The file must be the strict trial object in [Local script example](local-script.md). `references/trial.json` is a synthetic sample of that shape for the documented fixture. The hub treats a trial as a client declaration; the mechanical check does not prove the business result, and an independent reviewer still approves the change set. Repeat `check` and `install` for `contract-review`, `monthly-business-report`, `support-triage`, `employee-onboarding` and `incident-postmortem`, each with a trial from a run of that skill. Those skills do not ship a sample trial.

A product line does not take `--trial`. Install registers a draft knowledge-source asset. It does not import the tools and it does not change the running product-line list:

```sh
node apps/server/src/cli.ts modules check --catalog ../circle-packs/modules.json --module enterprise
node apps/server/src/cli.ts modules install \
  --catalog ../circle-packs/modules.json \
  --module enterprise \
  --scope scp_lab
```

To execute the product-line tools, an authorized deploy points `CIRCLE_HUB_PRODUCT_LINES` at an `installed-product-lines/1` file outside Git. Paths in that file resolve relative to the file itself. When the variable is unset, the hub uses its own `packs/installed-product-lines.json` (APV and Meridian), which does not include this pack. Shared knowledge tools stay available when the product-line list is empty.

On Linux, including a Linux `dev:stack`, the same hub can check and install these modules and cannot execute a frozen tool or hook. See [macOS sandbox warning](sandbox.md).
