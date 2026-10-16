---
name: apv-mindmap-compile
description: Compile an APV test mindmap (the JSON export, cases with an 18-digit autoid) into the execution workbook case.xlsx for one build, using the circle-hub tools for the build's command tree, the manuals and ZenTao. Use when asked to compile, 编译 or turn a mindmap into test cases for APV.
titleZh: APV 脑图用例编译
---

# APV 脑图用例编译

Circle binding: Circle 1.7.0 or newer uses the `hub` extension, `/hub login` and `hub_tool_*`. Other harnesses expose the declared remote tools through their own adapters. Former Circle extension, command and tool names are not aliases.

Turn a test mindmap into the execution workbook for one APV build. The scripts in `scripts/` do every step that has one right answer; you do the two steps that need judgement, **recompose** and **author**, and the scripts check both. Nothing runs on a device here: a written case is "emitted, unverified".

Read `references/contract.md` before writing any JSON: it has the exact shapes.

## 0. What you need

- The mindmap JSON export in the workspace. A `.xmind` file is not this format; ask for the export.
- The version line (for example `10.4`), and a build if the user names one.
- circle-hub tools, offered after `/hub login` as `hub_tool_*`: `hub_tool_buildsite_versions`, `hub_tool_buildsite_command_heads`, `hub_tool_buildsite_command_param`, `hub_tool_buildsite_command_check`, `hub_tool_docs_search`, `hub_tool_docs_section`, `hub_tool_zentao_bug_search`, `hub_tool_zentao_bug_detail`, `hub_tool_knowledge_claim_submit`. If they are missing, say so and stop: do not write commands from memory.

The batch folder is `out/`; the scripts write every result there, and these are the files a run on the server hands back. On the server there is nobody to ask: the request is in `inputs.json` (`mindmap`, `versionLine`, optionally `build`), and the mindmap file is next to it. A bot's run also carries `trigger` (the schedule time or the connector event that started it); it changes nothing in the steps, and with no `build` named a scheduled run compiles for the latest formal build of that day.

## 1. Prep (script)

```
node <skill>/scripts/prep.mjs <mindmap.json> out
```

It writes `manifest.json`: every case with its autoid, group path, layout and step intents, and never a command. On `ok:false`, tell the user the reason; the whole batch stops (one root only, 18-digit autoids, no duplicates).

## 2. Bind the build

Call `hub_tool_buildsite_versions` for the version line. Use the build the user named; otherwise the latest **formal** build (a `Rel_` build with a release date) on the main platform (`platform` null), unless the user names a platform. A Beta build only when the user asks for it. Skip a build marked `current: false`: the site lists conflicting rebuilds of it. If the bound build has `commandTreeAvailable: false`, stop and say so: there is no command tree to check against.

Every later query passes this build's `buildId` as `build`, because the same build name exists on several platforms. The case files keep the build name, as the tools return it in `build`.

When the tree is an approved external source instead (no entry in the site), the same rule with the source artifact id: pass the `sar_` id as `build` and `sourceArtifactId`, and keep the human-readable build name in `display_build` in `out/machine_mindmap.json`. The server answers `command_check` for a `sar_` with top-level `build`/`buildId` equal to the sar id, so the receipts still match the bound build. The workbook and `compile_report.json` carry both: `build` is the sar id and `display_build` is the name a reader recognizes.

## 3. Recompose (you), then check (script)

Write `out/machine_mindmap.json`: for each case its bucket, its contract triple (intent, verification method, expectation) and its expectations by step, each with an origin.

- **Relocate, never write.** Every contract field and expectation is the whole text of one source atom: the case title, a step, or an expectation (`title`, `step:<n>`, `expectation:<label or n>`). A numbering prefix such as `1.` or `[check1]` may be left off; nothing else may change.
- A spec sentence or a ZenTao bug may also be a source (`spec:<file>:<line>`, `defect:zentao:BUG-<n>:title|description`), only verbatim and only after you read it with the tools.
- A case whose source lacks steps or expectations is `true_gap`: no contract, and what is missing goes into `proposal` as plain sentences. Do not fill the gap yourself.
- Manuals are never a source for the contract.

```
node <skill>/scripts/check-recompose.mjs out
```

Fix every violation it lists and run it again until `ok:true`.

## 4. Author (you)

For each case that is not `true_gap`, write `out/cases/<autoid>.json`, the mechanical case.

- `description.intent_verbatim` and `description.group_path` are copied byte for byte from the contract and the manifest.
- The case's `build` is what the receipts name as `build` (the site's build name, or the `sar_` id for an external source); the human-readable name lives once, in `machine_mindmap.json`'s `display_build`, and the gate checks every case's `build` against `machine_mindmap.build`.
- **Every device command comes from the bound build.** Find heads with `hub_tool_buildsite_command_heads`, arguments with `hub_tool_buildsite_command_param`, and the manual with `hub_tool_docs_search` for the version line (`version`, which searches that version's CLI manual) and `hub_tool_docs_section` (the section that starts `**<head>**`). Never write a command from memory, and never "repair" a command the author wrote.
- `hub_tool_buildsite_command_param` lists every signature of a head. When `overloaded` is true there is more than one and `parameters` is empty: pick the signature whose parameters say what the case does, and write the arguments in that signature's order.
- When `hub_tool_docs_search` for the version line fails (for example `SOURCE_FORBIDDEN` or `SOURCE_ABSENT`), the manual was not available to this run. Go on without it and write in the report that the manual was not obtained; do not conclude that the version has no manual, because the server gives an ordinary identity the same answer for absent and not allowed. The manual only explains how a value shows on screen; it never decides a command or an expectation.
- PLM (`hub_tool_zentao_products` → `hub_tool_zentao_bug_search`): resolve the product id from the product listing first and confirm it with one status-filtered search that returns bugs (a product named exactly like the line can be empty while the line's bugs live under a family product); never guess an id, and a name passed as `product` is refused. Read full history with `hub_tool_zentao_bug_detail`: the fix comment carries the Fixed Details that decide behavior questions. Mindmap titles often carry the bug id itself (the `79758` in a title is a PLM bug) — look it up directly. "No bug found" still never means "none exists": record what was searched and where coverage stopped.
- Spec (`/webdav/spec`): list the spec directory by **filename** first (`hub_tool_docs_list`, paginated by `page`) and read the files whose names match the feature; fall back to `hub_tool_docs_search` narrowed to a distinctive term. Search pages 20 files per call with a cursor bound to one query: time-box the paging, and when `coverage.complete` is false say exactly how far the search got instead of claiming the spec does not exist. The version's release notes (`/webdav/app/rel_<line>/app_cn/app_cn.md`) often state the shipped behavior more precisely than the spec — check them too.
- Blocks: `CONFIG` (commands to configure), `OBSERVE_ASSERT` (a show command and one or more checks: `found`, `not_found`, `abs_found` with a pattern), `CLIENT` (a command on a test-env client — `dig` and friends — with its own checks against the client output; the workbook renders it as a `test_env` row whose method is the client name, `routera` and such, followed by `check_point` rows), `SLEEP` (seconds), `STEP` (a row the blocks cannot express, with a reason in `escape_hatches`). Client traffic is a `CLIENT` block, never a `STEP`.
- Each expectation of the case is asserted **exactly once**, carrying its id `u1:<autoid>:<n>:<index>`, and listed in `expectation_binding` with what backs it (`Author`, `Manual`, `CapabilityXml`, `Spec`, `DefectSpec`).
- Expected values come from the contract's expectations. A manual may explain how a value shows on screen; device output never decides what is expected.
- Clean up what the case configures: add the inverse commands after the checks.
- Then verify **all** the case's device commands (init, CONFIG and observation commands; `CLIENT` commands are not device commands) with `buildsite.command_check`. Each call's raw return is saved verbatim by the server under `.circle/hub-returns/` and the result carries `savedAs`; write `out/checks/<autoid>.json` as the pointer `{"savedAs": "<that path>"}` and nothing else — never transcribe a response. `command_receipts` is the mechanical projection of the pointed-to file — per returned command `{command, build, status, head, violations, evidenceId}` — and the gate loads the file itself, requires the check to cover exactly the case's device commands, and re-derives the projection. When no server-saved check covers a case, say so plainly, mark it **未核对** and stop before the gate: an unverified command is never dressed up as a verified one. The real barrier is server-side: on a run submission the server re-runs `command_check` for every device command in the workbook against the bound build and refuses the submission when a command is not in the tree, independent of anything the skill wrote.
- The test data must be the bed's own: listener IPs, client names and answer records come from the testbed's topology (the gateway's `bed_topology` when the run capability is connected), not from a synthetic demo environment and never invented. A case may only name an IP that exists on the bed. Before a compile whose workbook will run, confirm the build on the bed equals the bound build — the gateway checks it and refuses a mismatch.
- On a run submission pass the asset id of the approved source artifact as `commandSourceAssetId` and either the `sar_` id or the build name as `build`; the server accepts both, hands the build name to the gateway's `env_prepare` for the bed check, and re-runs the checks against the artifact's tree, refusing a mismatch.

## 5. Gate (script)

```
node <skill>/scripts/gate.mjs out --bed-facts <gateway.topology evidence> --contract <the Excel function contract the execution side uses>
```

`--bed-facts` is required: the hub's `gateway.topology` evidence file saved verbatim (it carries real addresses and never enters Git). Without it — or with an empty device list — the whole batch is refused as `bed_facts_unavailable`; the check never folds into a pass. From the facts the gate derives reachable subnets, per-device carried addresses, trigger hosts (routers/clients), load balancers, the ★ listener list (LB addresses whose subnet holds a trigger host), listener→same-subnet-trigger pairing (names lowercased), blind addresses and server addresses. Per case it then checks mechanically:

| code | rule | severity |
|---|---|---|
| address_not_on_bed | an IPv4/IPv6 literal in no reachable subnet, compile-time introduced | block, terminal underdetermined |
| environment_disclosure | the same, but the literal is author-verbatim from the mindmap source | block, terminal environment_disclosure |
| listener_not_on_device | a `sdns listener` address the device does not carry; a case with exactly one such placeholder and a unique in-subnet device address gets a binding proposal, N>1 distinct placeholders get none | block, terminal by origin |
| listener_not_on_device (VIP) | an `slb virtual` address must sit in a trigger-hosted reachable subnet and not be another device's carried address; an `sdns listener` bound to this case's legal VIP passes | block, terminal by origin |
| query_target_not_listener | a `dig`/`curl` target that is not the case's own configured listener or legal VIP | block |
| trigger_host_not_paired_with_target | the dispatching host is not in the target's same-subnet pairing (paired hosts named) | block |
| backend_not_server | a record/real/pool address that is not a server address | warn |
| feature_prerequisite_missing | a `forward_only`/`zone forward` command whose own literals carry no upstream (a server-carried address or a `services` entry with proto=dns) | block, terminal underdetermined |

Origins decide the terminal status: a compile-time literal or a missing upstream is **underdetermined** (a data gap, not the author's error and not a compile error), an author-verbatim off-bed literal is **environment_disclosure**, anything else is a compile error. None of the three produces a workbook.

The gate never rewrites data: binding proposals land in `out/bindings.proposed.json` ({autoid, rule, from, to}). After a human copies the accepted ones to `out/bindings.json`, emit applies each binding to the listener and the dig target together, requires the gate to be green with them applied, and lists every replacement in the delivery report.

The `--contract` file is the execution side's Excel function contract (`schema` `ist.excel.function-contract`), the copy the user registered with the server; the gate takes the client names a `CLIENT` block may use from its enabled `test_env` methods and keeps no list of its own. Without it every `CLIENT` block is `client_not_checked`. `client_not_in_contract` means the framework cannot dispatch to that name (a device reboot, for instance, is not a client): the case is an **unsupported feature** as written, like a command missing from the tree — do not swap in another client or method.

For each rejected case, fix what the violations name and run it again; at most three rounds per case, then leave it rejected. `command_not_in_tree` means the build does not have the command: the case is an **unsupported feature** for this build. Do not look for another command and do not retry it.

## 6. Emit (script) and report

```
node <skill>/scripts/emit.mjs out --contract <the registered Excel function contract> --author <user>
```

`--contract` is the same registered contract copy the gate uses: the workbook carries the InfoTest identity markers the gateway checks — exactly one `IST_EXCEL_CONTRACT` cell row before the execution header with the contract's `runtime.minimum_version` and `contract_sha256`, and the `IST_EXECUTION_SHEET` defined name on the header row. Without a contract there is nothing to write: emit refuses.

Report the totals from `compile_report.json`, the path and SHA-256 of `case.xlsx`, and the cases that were not written with their reasons (`unsuccessful_cases.md`). Say plainly that nothing has run on a device.

## 7. What you learned

When the user corrects you, or you find a fact that a later compile would need (a command a build renamed, a field that joins two systems), submit it with `hub_tool_knowledge_claim_submit`, with the evidence ids you read it from. It becomes a candidate that someone reviews; do not rely on it until it is published.
