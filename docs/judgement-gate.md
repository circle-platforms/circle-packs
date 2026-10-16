---
nav_order: 6
---

# Judgement-gate template

The split in `skills/apv-mindmap-compile` is the pattern for a new skill: the model writes one schema'd contract, and scripts do the rest.

1. The contract carries verbatim quotes and source pointers. A pointer is `{"savedAs":"<path>"}`. The file may be a hub `docs.get` or `docs.section` return, or a user-provided UTF-8 file at that relative path.
2. The gate checks the schema, refuses a transcribed tool return, checks each quote against that original, reads the evidence id from a hub return, and refuses the run when any input item is missing from the contract. A JSON original with an `id` on each item is covered by those ids. Other text is covered line by line.
3. The emit step recomputes the decision from that original and from tables in the skill. It refuses a contract whose bytes changed after the gate.

A judgement that defines policy is extracted once, approved by a person, and pinned by SHA. Later runs point at that file. They do not ask the model to write it again. That includes a risk table, an SLA table, a metric list, an access-rule table, and which events define alert duration and customer impact.

```sh
node templates/judgement-gate/pin.mjs path/to/policy.json --out path/to/policy.pin.json --approve
```

The gate compares those bytes to the pin and refuses a mismatch (`policy_pin_mismatch`, or `policy_not_approved` when `approved` is not true). Emit uses `policy_changed_after_gate` when the policy bytes change after the gate, and `contract_changed_after_gate` when a per-run contract changes.

A per-run judgement that is still semantic (a clause kind, a ticket severity, an event label, a header role) is written twice, independently. The script escalates any disagreement to a person (`needs_human`). It does not pick a winner, and it does not ask a model to review the model. The script checks the quote at its offset, that a cited cue sits next to the cited predicate, and that a number and its unit parse. `天` and `日` are days. `月` is a month.

The scaffold, the generator and the per-skill table are in [templates/judgement-gate/README.md](https://github.com/circle-platforms/circle-packs/blob/main/templates/judgement-gate/README.md).

```sh
node templates/judgement-gate/generate.mjs <id> --title "English title" --title-zh "中文标题"
```

`scripts/pointers.mjs` is copied into the skill. Skills do not import each other.
