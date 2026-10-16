# Judgement-gate template

A new skill that follows the APV mind-map compile split is four steps:

1. **Judgement.** The model writes one schema'd contract. Every claim carries a verbatim quote and a source pointer. The pointer is `{"savedAs":"<path>"}` and nothing else.
2. **Gate (script).** Schema validation, a refusal when the model transcribed a tool return, a verbatim check of each quote against the original, a check that every input item is covered, and the evidence id read back from a hub return. The original may be that hub return or a user-provided UTF-8 file at the relative `savedAs` path.
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
| contract-review | every `第N条` or Markdown heading, with permit/forbid, a polarity cue, and a value copied from the quote | risk, from the pinned `references/risk-policy.json`; a heading the contract skips fails the gate |
| monthly-business-report | a header map for each raw CSV | totals from the human-approved `metrics.yaml`; cell values are not copied from the model |
| support-triage | intent, severity, and a verbatim quote for every ticket | SLA, queue, and the credential filter, from the pinned policy |
| employee-onboarding | `policy_rules.json`: permit, forbid, a tenure floor, or an admin downgrade, each quoted | whether a requested role is permitted, short of tenure, or downgraded |
| incident-postmortem | a label per log line, with the timestamp span | MTTR from those labels; the gate fails when the pinned start or end event is missing |

The sample trial shape for a skill that only runs a script is still [docs/local-script.md](../../docs/local-script.md). This template adds the judgement file in front of that script.

## Pin a policy, do not re-extract it

A judgement that defines policy is extracted once, approved by a person, and pinned by SHA. Later runs point at that file. They do not ask the model to write it again. That includes a risk table, an SLA table, a metric list, an access-rule table, and the definition of which event starts an incident. The gate records the file's SHA. Emit refuses the run when those bytes differ. A per-run contract (quotes, labels, a header map) is not that file.
