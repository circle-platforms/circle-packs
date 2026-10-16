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
| contract-review | two extracts of every heading, with a kind, a quote and an offset | risk from the pinned policy where the extracts agree; a disagreement is `needs_human` |
| monthly-business-report | two header maps for each raw CSV | the period total from the pinned `metrics.yaml`; a header disagreement writes no total |
| support-triage | two extracts of intent, severity, and a quote at an offset for every ticket | SLA and queue where the extracts agree; an unknown intent is `needs_human` |
| employee-onboarding | one approved rule file, pinned after two extracts were compared | whether a requested role is permitted, not yet due, or downgraded |
| incident-postmortem | two label files, one event per line | alert duration and customer-impact duration from the pinned definitions |

The sample trial shape for a skill that only runs a script is still [docs/local-script.md](../../docs/local-script.md). This template adds the judgement file in front of that script.

## Pin a policy, do not re-extract it

A judgement that defines policy is extracted once, approved by a person, and pinned by SHA. Later runs point at that file. They do not ask the model to write it again. That includes a risk table, an SLA table, a metric list, an access-rule table, and which events define alert duration and customer impact.

```sh
node templates/judgement-gate/pin.mjs path/to/policy.json --out path/to/policy.pin.json --approve
```

The pin is `{schema: "circle-packs/policy-pin/1", sha256, approved}`. The gate compares the policy bytes to `sha256` and refuses a mismatch with `policy_pin_mismatch`. `approved` must be true. Emit refuses a policy that changed after the gate with `policy_changed_after_gate`. A per-run contract that changed uses `contract_changed_after_gate`.

Where a label is still a judgement (kind, severity, event, header role), run that judgement twice into two files. The script compares them. A disagreement is `needs_human`. It is not auto-resolved, and a third model pass is not a review of the first two. The script only checks facts with one answer: the quote is at that offset, a cited cue is inside the quote and adjacent to the cited predicate, a number parses, and `天` / `日` are not `月`. The scaffold's own gate still takes one contract. A skill adds the second file when its domain needs it.
