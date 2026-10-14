<h1 align="center">circle-packs</h1>

<p align="center">Skill packs and product-line packs installed on circle-hub: versioned, SHA-pinned, approved by an independent reviewer.</p>

<p align="center">
  <a href="https://circle-platforms.github.io/circle-packs/">Docs</a> ·
  <a href="modules.json">Module list</a> ·
  <a href="docs/product-line-pack.md">APV status</a> ·
  <a href="CHANGELOG.md">Changelog</a> ·
  <a href="README.zh-CN.md">中文</a>
</p>

---

Skill packs and product-line packs installed on [circle-hub](https://github.com/circle-platforms/circle-hub), the team hub for [Circle](https://github.com/circle-platforms/circle). Each module has its own version and is installed through circle-hub's own mechanism: a skill pack is pushed, a trial is recorded, and an independent reviewer approves it. Packs are not released together with circle-hub.

The layout and the adaptation sheet every pack fills in are the [product-line pack exemplar](https://github.com/circle-platforms/circle-hub/blob/main/docs/design/product-line-pack.md) ([English](https://github.com/circle-platforms/circle-hub/blob/main/docs/design/en/product-line-pack.md)). APV's status in this repository is [docs/product-line-pack.md](docs/product-line-pack.md).

## What is here

| Directory | Contents | Status |
|---|---|---|
| [skills/apv-mindmap-compile](skills/apv-mindmap-compile/SKILL.md) | Compiles an APV mind map into a workbook that can be run: recomposes the intent, checks each device command against the bound build, and emits a nine-column sheet. Version 0.2.7 | on main |
| [products/apv](products/apv/README.md) | APV product-line pack: `product-line.json`, `tools/`, `hooks/`, `resources/`, `sources/`, `flows/`, the adaptation sheet in its README, and 18 synthetic tests. Version 1.0.0 | on main |
| [skills/apv-defect-claims](skills/apv-defect-claims/SKILL.md) | Turns ZenTao defect records into candidate knowledge claims with script origin: product resolution and bug picks are model judgement, the field-to-predicate extraction is a script with no inference, evidence ids pass through. Version 0.1.0 | on main |
| [skills/apv-product-qa](skills/apv-product-qa/SKILL.md) | Answers APV product questions from the manuals only: the manual version is pinned with docs.list, sections are read directly by anchor, the answer is model judgement with an evidence tag on every paragraph, quotes are checked verbatim against hub-saved sections by a script, and a no-evidence answer requires a real section miss. Version 0.1.3 | on main |
| [skills/apv-case-review](skills/apv-case-review/SKILL.md) | Reviews a compiled APV batch against its bound build: structure, command-tree and function-contract checks are scripts, coverage and risk are model judgement; the report carries evidence ids and findings are submitted as candidate claims. Version 0.1.3 | on main |

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
node --test tools/*.test.ts skills/*/tests/*.test.mjs
```

Product-line pack tests use the dependency set from circle-hub commit `dc93c69826f73f16d2f20f7520ba4c6663d014ac`, the same commit pinned by `.github/workflows/checks.yml`. Check out that commit and run `npm ci --ignore-scripts` there before linking its `node_modules` into this repository. This pins the test environment, not a supported production hub version. Then:

```sh
ln -s <circle-hub-checkout>/node_modules node_modules
node --experimental-strip-types --test 'products/apv/tests/*.test.mjs'
```

Tests use synthetic samples. They show what the scripts do. They do not show a result on a real product or a real device.

## Status

circle-packs is under development and is not a supported production release. Read [SECURITY.md](SECURITY.md) before using a pack anywhere that matters.

## Contributing and security

See [CONTRIBUTING.md](CONTRIBUTING.md), [AGENTS.md](AGENTS.md) for coding agents, and circle-hub's [compatibility matrix](https://github.com/circle-platforms/circle-hub/blob/main/docs/compatibility.md) for what the three repositories expect of each other. Report security problems as described in [SECURITY.md](SECURITY.md). Everyone taking part follows the [Code of Conduct](CODE_OF_CONDUCT.md).

circle-packs is one of three repositories: [circle](https://github.com/circle-platforms/circle) is the agent, [circle-hub](https://github.com/circle-platforms/circle-hub) is the hub it signs in to, and circle-packs holds the packs installed on the hub.

## License

circle-packs is released under the [Apache License 2.0](LICENSE). The [NOTICE](NOTICE) file names the copyright holder and reserves the Circle and Circle Hub names, logos and icons: the license covers the code and its documentation, not the marks. Until 2026-10-13 the repository was under the MIT License. The repository bundles no third-party components; a pack's tools import only circle-hub's dependency set, described in that repository's THIRD_PARTY_NOTICES.md. Contributions are accepted under the [contributor terms](CONTRIBUTING.md#contributor-terms).
