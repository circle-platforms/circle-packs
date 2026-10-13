# Changelog

All notable changes to circle-packs are listed here, newest first. Modules carry their own versions in their manifests; this file tracks the repository. Nothing is tagged yet, so everything is under Unreleased.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).

## Unreleased

### Added

- Public repository facade: English README with a Chinese translation, MIT license, contributing guide, security policy, code of conduct and this changelog.
- `products/apv`, the first product-line pack written to the exemplar: `product-line.json`, five Tool implementations (mind map, contracts, function contract, dialect, workbook), three `hub-hook/1` handlers (device command tree, host destructive commands, workbook contract), connector, source, flow and resource declarations, the filled adaptation sheet and 18 synthetic tests.
- `skills/apv-mindmap-compile`, from 0.2.4 (the version Circle produced and an independent reviewer accepted) to 0.2.7: build binding, command sources bound by their sar id, client rows checked against the registered Excel function contract, no product facts kept in the skill.
- `products/apv` 1.1.0 adds the `defect-claims` Tool (ZenTao defect record → candidate claims, field to predicate, no inference) and `skills/apv-defect-claims` 0.1.0 drives it: product resolution and bug picks as judgement, extraction and the submitted shape as scripts; 4 + 5 synthetic tests.
- `skills/apv-product-qa` 0.1.1: answers product questions from the manuals only — citations checked verbatim against hub-saved sections, paragraph evidence tags, a scripted query log, and no answer without evidence; 9 synthetic tests.
- `skills/apv-case-review` 0.1.3: reviews a compiled batch against its bound build — structure, command-tree and function-contract checks as scripts (`prep`, `check collect/apply`, `report`), coverage and risk as model judgement, findings with evidence ids and ready-to-submit claims; 21 synthetic tests.
- `modules.json`, the installer manifest: one entry per module with its files, SHA-256 per file and a digest that ordinary shell tools can recompute; `tools/modules.ts` writes and checks it.
- `docs/product-line-pack.md`: this repository's conventions and the status of APV's four capabilities, pointing at the canonical exemplar in circle-hub.

### Changed

- `products/apv` 1.0.1: the Tool implementations hash with the global WebCrypto instead of importing `node:crypto`, which the declared import set does not allow.
- The host destructive-command hook blocks only real self-destruction; ordinary client steps such as `dig`, `curl`, `ping`, `tc` and `iptables` pass.
- Tests use documentation addresses (192.0.2.0/24); no lab address or local path appears in the repository.
- Packs name circle-hub as the platform they are installed on.
