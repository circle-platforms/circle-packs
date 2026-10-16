<h1 align="center">circle-packs</h1>

<p align="center">Skill packs and product-line packs installed on circle-hub: versioned, SHA-pinned, approved by an independent reviewer.</p>

<p align="center">
  <a href="https://circle-platforms.github.io/circle-packs/">Docs</a> ·
  <a href="modules.json">Module list</a> ·
  <a href="docs/product-line-pack.md">APV status</a> ·
  <a href="docs/enterprise-packs.md">Enterprise packs</a> ·
  <a href="CHANGELOG.md">Changelog</a> ·
  <a href="README.zh-CN.md">中文</a>
</p>

---

Skill packs and product-line packs installed on [circle-hub](https://github.com/circle-platforms/circle-hub), the team hub for [Circle](https://github.com/circle-platforms/circle). Each module has its own version and is installed through circle-hub's own mechanism: a skill pack is pushed, a trial is recorded, and an independent reviewer approves it. Packs are not released together with circle-hub.

The layout and the adaptation sheet every pack fills in are the [product-line pack exemplar](https://github.com/circle-platforms/circle-hub/blob/main/docs/design/product-line-pack.md) ([English](https://github.com/circle-platforms/circle-hub/blob/main/docs/design/en/product-line-pack.md)). APV's status in this repository is [docs/product-line-pack.md](docs/product-line-pack.md). Enterprise packs and a dev:stack install are [docs/enterprise-packs.md](docs/enterprise-packs.md).

Skill manifests are English. A Chinese title is the `titleZh` field in `SKILL.md` frontmatter, because circle-hub's `SkillManifest` is strict and rejects unknown keys. The same rule keeps `titleZh` out of `product-line.json`. Flow files may carry both `title` and `titleZh`.

## What is here

| Directory | Contents | Status |
|---|---|---|
| [skills/apv-mindmap-compile](skills/apv-mindmap-compile/SKILL.md) | Compiles an APV mind map into a workbook that can be run: recomposes the intent, checks each device command against the bound build, and emits a nine-column sheet. Version 0.4.1 | on main |
| [products/apv](products/apv/README.md) | APV product-line pack: `product-line.json`, `tools/`, `hooks/`, `resources/`, `sources/`, `flows/`, the adaptation sheet in its README, and synthetic tests. Version 1.4.2 | on main |
| [skills/apv-defect-claims](skills/apv-defect-claims/SKILL.md) | Turns ZenTao defect records into candidate knowledge claims with script origin: product resolution and bug picks are model judgement, the field-to-predicate extraction is a script with no inference, evidence ids pass through. Version 0.2.1 | on main |
| [skills/apv-product-qa](skills/apv-product-qa/SKILL.md) | Answers APV product questions from the manuals only: the manual version is pinned with docs.list, sections are read directly by anchor, the answer is model judgement with an evidence tag on every paragraph, quotes are checked verbatim against hub-saved sections by a script, and a no-evidence answer requires a real section miss. Version 0.2.1 | on main |
| [skills/apv-case-review](skills/apv-case-review/SKILL.md) | Reviews a compiled APV batch against its bound build: structure, command-tree and function-contract checks are scripts, coverage and risk are model judgement; the report carries evidence ids and findings are submitted as candidate claims. Version 0.2.1 | on main |
| [products/enterprise](products/enterprise/README.md) | General-purpose product line: pinned policy tables, reconciled CSV totals, severity floors, tenure in days or months, and separate alert and customer-impact durations. Version 1.3.0 | draft |
| [skills/contract-review](skills/contract-review/SKILL.md) | Two extracts name a kind and quote each clause at an offset. A script scores a term from the pinned day floor only where they agree. Version 1.3.0 | draft |
| [skills/monthly-business-report](skills/monthly-business-report/SKILL.md) | Two extracts map arbitrary CSV headers. The script filters the period and reconciles the total against rejected rows. Version 1.3.0 | draft |
| [skills/support-triage](skills/support-triage/SKILL.md) | Two extracts name intent and severity. An unknown intent is left for a person. A security floor comes from the pinned policy. Version 1.3.0 | draft |
| [skills/employee-onboarding](skills/employee-onboarding/SKILL.md) | Later runs use the pinned rules. Days and months stay distinct, and a grant names its approver and date. Version 1.3.0 | draft |
| [skills/incident-postmortem](skills/incident-postmortem/SKILL.md) | Two extracts label lines. The script reports alert duration and customer impact, and refuses a timestamp with no zone. Version 1.3.0 | draft |
| [skills/local-script](skills/local-script/SKILL.md) | Counts lines and words with a local script. Documents the manifest, declared tool, output path and a sample trial record. Version 1.0.0 | draft |

## What stays out

Command trees, Excel function contracts, bed configuration, mind-map originals and device returns do not enter Git. At run time a person uploads them to circle-hub as originals. They are registered with a SHA, and a tool reads them only after an independent reviewer has approved them. This repository holds procedures, scripts and synthetic tests.

## Module list

[modules.json](modules.json) is the list circle-hub's installer reads (schema `circle-packs/modules/1`). One entry per module:

| Field | Meaning |
|---|---|
| `id` | Module id, the same as the directory name and the id in the module's own manifest |
| `kind` | `skill-pack` (`skills/<id>/skillpack.json`) or `product-line` (`products/<id>/product-line.json`) |
| `root` / `manifestPath` | Relative paths of the module directory and of its own manifest |
| `version` | Taken from the module's own manifest |
| `files` | Relative path and SHA-256 of every file under the module directory, hidden files excluded, sorted by path |
| `digest` | SHA-256 of `files` rendered in `sha256sum` form, one line `<sha256>  <path>`. Ordinary shell tools can recompute it |

The installer freezes those bytes and then uses circle-hub's own registration, trial record and independent approval. The list itself approves nothing. After a module's files change, run `node tools/modules.ts write` to rewrite the list.

## Checks

Node.js 24. The first two commands need nothing installed:

```sh
node tools/modules.ts check
node --test tools/*.test.ts skills/*/tests/*.test.mjs templates/judgement-gate/scaffold/tests/*.test.mjs
```

Product-line pack tests use the dependency set from circle-hub commit `dc93c69826f73f16d2f20f7520ba4c6663d014ac`, the same commit pinned by `.github/workflows/checks.yml`. Check out that commit and run `npm ci --ignore-scripts` there before linking its `node_modules` into this repository. This pins the test environment, not a supported production hub version. Then:

```sh
ln -s <circle-hub-checkout>/node_modules node_modules
node --experimental-strip-types --test 'products/*/tests/*.test.mjs'
HUB_ROOT=<circle-hub-checkout> node --experimental-strip-types tools/validate-with-hub.mjs
```

`tools/validate-with-hub.mjs` parses every `skillpack.json` with circle-hub's `SkillManifest` and every `product-line.json` with `ProductLineManifest` and `verifyProductLine`. It skips, and exits 0, when `HUB_ROOT` is unset and `../circle-hub` does not exist. Point it at a checkout that contains `packages/methods/src/product-modules.ts`. The dependency pin above supplies the test libraries; that older tree's product-line schema does not accept `tools` or `hooks`.

Frozen product-line tools run only where circle-hub has a process isolation adapter. Today that adapter is macOS. A Linux host reports `SANDBOX_UNAVAILABLE` (`This execution host has no supported process isolation adapter`). A Linux dev:stack can still check and install modules. The Linux adapter is planned in circle-hub, not in this repository. See [docs/sandbox.md](docs/sandbox.md).

Tests use synthetic samples. They show what the scripts do. They do not show a result on a real product or a real device.

## Status

circle-packs is under development and is not a supported production release. Read [SECURITY.md](SECURITY.md) before using a pack anywhere that matters.

## Contributing and security

See [CONTRIBUTING.md](CONTRIBUTING.md), [AGENTS.md](AGENTS.md) for coding agents, and circle-hub's [compatibility matrix](https://github.com/circle-platforms/circle-hub/blob/main/docs/compatibility.md) for what the three repositories expect of each other. Report security problems as described in [SECURITY.md](SECURITY.md). Everyone taking part follows the [Code of Conduct](CODE_OF_CONDUCT.md).

circle-packs is one of three repositories: [circle](https://github.com/circle-platforms/circle) is the agent, [circle-hub](https://github.com/circle-platforms/circle-hub) is the hub it signs in to, and circle-packs holds the packs installed on the hub.

## License

circle-packs is released under the [Apache License 2.0](LICENSE). The [NOTICE](NOTICE) file names the copyright holder and reserves the Circle and Circle Hub names, logos and icons: the license covers the code and its documentation, not the marks. Until 2026-10-13 the repository was under the MIT License. The repository bundles no third-party components; a pack's tools import only circle-hub's dependency set, described in that repository's THIRD_PARTY_NOTICES.md. Contributions are accepted under the [contributor terms](CONTRIBUTING.md#contributor-terms).
