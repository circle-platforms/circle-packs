# Judgement-gate template

A new skill that follows the APV mind-map compile split is four steps:

1. **Judgement.** The model writes one schema'd contract. Every claim carries a verbatim quote and a source pointer. The pointer is `{"savedAs":"<path>"}` and nothing else.
2. **Gate (script).** Schema validation, a refusal when the model transcribed a tool return, a verbatim check of each quote against the server-saved original, and the evidence id read back from that original.
3. **Recompute (script).** Numbers, risk, routes, and durations are derived again from the saved original and from tables in the skill. The model's derived values are not copied through.
4. **Emit (script).** The declared outputs are written from the gate record. Emit refuses the run when the contract bytes changed after the gate.

`scripts/pointers.mjs` is the shared part. The generator copies it. A skill does not import the template, and it does not import another skill.

## Scaffold a skill

From the repository root:

```sh
node templates/judgement-gate/generate.mjs <id> --title "English title" --title-zh "中文标题" --owner enterprise --tool docs.get
```

That writes `skills/<id>/` with `skillpack.json`, `SKILL.md`, `references/contract.md`, `scripts/pointers.mjs`, `scripts/gate.mjs`, `scripts/emit.mjs`, and a test. `--dest` writes somewhere else. `--force` replaces an existing directory.

Then replace the generic contract and the two scripts with the domain rules. Leave `pointers.mjs` unchanged so it stays the same file the template ships. Run `node tools/modules.ts write` after the skill is real.

`title` in `skillpack.json` stays English. The Chinese title is `titleZh` in the `SKILL.md` frontmatter.

## What the five enterprise skills do with it

| Skill | Judgement file | What the code decides |
|---|---|---|
| contract-review | clauses, each `permit` or `forbid`, with a value copied from the quote | risk, from `references/risk-policy.json`; headings the source is missing |
| monthly-business-report | pointers to the extracts only | totals from the human-approved `metrics.yaml` |
| support-triage | one intent and a verbatim quote per ticket | SLA, queue, and the credential filter |
| employee-onboarding | `policy_rules.json`, each rule a permit or forbid quoted from the manual | whether a requested role is permitted |
| incident-postmortem | a label per log line | MTTR, and every missing field by name |

The sample trial shape for a skill that only runs a script is still [docs/local-script.md](../../docs/local-script.md). This template adds the judgement file in front of that script.
