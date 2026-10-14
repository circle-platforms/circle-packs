# Changelog

All notable changes to circle-packs are listed here, newest first. Modules carry their own versions in their manifests; this file tracks the repository. Nothing is tagged yet, so everything is under Unreleased.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).

## Unreleased

### Changed

- **Licensed under the Apache License 2.0**, as Circle and circle-hub are. `LICENSE` carries the canonical text and `NOTICE` names the copyright holder, records that the repository was under the MIT License until 2026-10-13 and reserves the Circle and Circle Hub marks. `CONTRIBUTING.md` has Circle's contributor terms (a sign-off on every commit and a license to the project); `SECURITY.md`, the issue and pull request templates and `.gitattributes` follow Circle's, in English. The documentation is published at <https://circle-platforms.github.io/circle-packs/> with the same site setup as Circle's.

### Added
- `products/apv` 1.3.2: `checkCommands` takes the byte-slot original last, matching the module runtime convention (literal args, then slot bytes) that the smoke run on 7420 exposed.
- `products/apv` 1.3.1: the execution flow checks device commands against the real bed's XML command-tree original — `tools/command-tree.ts` parses the frozen bytes with the hub's menu-path walk (saxes declared), `tools/command-check.ts` applies the hub's deterministic check rules and emits the sync receipt shape with the XML byte SHA; the JSON command-check original stays as the synthetic-fixture path.
- `products/apv` 1.3.0: the execution flow moved into the pack — `apv-case-execute-v2` runs on the hub transition driver with pure tools for the environment mapping, framework result parsing and refusal interpretation; the gateway resource declares a `hub-provider-observation/1` receiptPolicy; device verify hooks are issued per command and per host, the workbook rides a controlled byte slot and confirmed leases/terminal verification stay with the hub.
- `skills/apv-mindmap-compile` 0.3.0: the gate takes `--bed-facts` (the hub's gateway.topology evidence) and checks every case against the bed — reachable subnets, device-carried listeners, query targets, same-subnet trigger pairing, backend addresses and forward prerequisites. Off-bed literals split by origin (author-verbatim `environment_disclosure`, compile-time `underdetermined`), `slb virtual` VIPs pass on trigger-hosted subnets (an `sdns listener` on this case's legal VIP passes with them), a case with exactly one listener placeholder and a unique in-subnet device address gets a binding proposal (the dig target follows), and `forward_only`/`zone forward` without their own upstream literal is `feature_prerequisite_missing`. Proposals land in `bindings.proposed.json` for a human to confirm into `bindings.json` before emit applies them (listener and dig target together, gate re-run green).
- `skills/apv-mindmap-compile` 0.2.8: execution workbooks carry the InfoTest identity markers the gateway checks — the `IST_EXCEL_CONTRACT` cell row with the registered contract's `runtime.minimum_version` and `contract_sha256` before the header, and the `IST_EXECUTION_SHEET` defined name on it; emit takes `--contract` and refuses to write without it.

- Public repository facade: English README with a Chinese translation, license, contributing guide, security policy, code of conduct and this changelog.
- `products/apv`, the first product-line pack written to the exemplar: `product-line.json`, five Tool implementations (mind map, contracts, function contract, dialect, workbook), three `hub-hook/1` handlers (device command tree, host destructive commands, workbook contract), connector, source, flow and resource declarations, the filled adaptation sheet and 18 synthetic tests.
- `skills/apv-mindmap-compile`, from 0.2.4 (the version Circle produced and an independent reviewer accepted) to 0.2.7: build binding, command sources bound by their sar id, client rows checked against the registered Excel function contract, no product facts kept in the skill.
- `products/apv` 1.2.2: the product line names the case-gateway tools `gateway.*` through `toolAliases`, and the `host-policy` hook compares host names and policy keys case-insensitively (the bed topology reports `routerA`, workbooks write `routera`).
- `products/apv` 1.2.1: the workbook Tool checks shape only — host rows are recognised by token shape, the hard-coded host list is gone, and function-contract status is annotated instead of enforced; the closed host set and method enablement are decided by the `host-policy` and `workbook-contract` hooks.
- `products/apv` 1.2.0 adds the `host-policy` hook on `verify.hostCommand` (closed host set from the resource declaration, literal commands without template or substitution syntax, optional per-host prefix narrowing; fixed codes HOST_SET_UNDECLARED, HOST_NOT_IN_BED, COMMAND_NOT_LITERAL, HOST_COMMAND_OUTSIDE_POLICY) and the `allowedTestHosts` / `hostCommandPolicies` declaration fields filled at registration; 10 synthetic tests.
- `products/apv` 1.1.0 adds the `defect-claims` Tool (ZenTao defect record → candidate claims, field to predicate, no inference) and `skills/apv-defect-claims` 0.1.0 drives it: product resolution and bug picks as judgement, extraction and the submitted shape as scripts; 4 + 5 synthetic tests.
- `skills/apv-product-qa` 0.1.3: the manual version is pinned with `docs.list` and sections are read directly by anchor (the hub-side directory search is on hold until a large-document report bug is fixed); `cite.mjs --lookup` renders every hit and miss; a no-evidence answer requires a real section miss.
- `skills/apv-product-qa` 0.1.1: answers product questions from the manuals only — citations checked verbatim against hub-saved sections, paragraph evidence tags, a scripted query log, and no answer without evidence; 9 synthetic tests.
- `skills/apv-case-review` 0.1.3: reviews a compiled batch against its bound build — structure, command-tree and function-contract checks as scripts (`prep`, `check collect/apply`, `report`), coverage and risk as model judgement, findings with evidence ids and ready-to-submit claims; 21 synthetic tests.
- `modules.json`, the installer manifest: one entry per module with its files, SHA-256 per file and a digest that ordinary shell tools can recompute; `tools/modules.ts` writes and checks it.
- `docs/product-line-pack.md`: this repository's conventions and the status of APV's four capabilities, pointing at the canonical exemplar in circle-hub.

### Changed

- `products/apv` 1.0.1: the Tool implementations hash with the global WebCrypto instead of importing `node:crypto`, which the declared import set does not allow.
- The host destructive-command hook blocks only real self-destruction; ordinary client steps such as `dig`, `curl`, `ping`, `tc` and `iptables` pass.
- Tests use documentation addresses (192.0.2.0/24); no lab address or local path appears in the repository.
- Packs name circle-hub as the platform they are installed on.
