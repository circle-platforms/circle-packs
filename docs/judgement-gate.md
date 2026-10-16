---
nav_order: 6
---

# Judgement-gate template

The split in `skills/apv-mindmap-compile` is the pattern for a new skill: the model writes one schema'd contract, and scripts do the rest.

1. The contract carries verbatim quotes and source pointers. A pointer is `{"savedAs":"<path>"}`.
2. The gate checks the schema, refuses a transcribed tool return, checks each quote against the server-saved original, and reads the evidence id from that original.
3. The emit step recomputes the decision from that original and from tables in the skill. It refuses a contract whose bytes changed after the gate.

The scaffold, the generator and the per-skill table are in [templates/judgement-gate/README.md](https://github.com/circle-platforms/circle-packs/blob/main/templates/judgement-gate/README.md).

```sh
node templates/judgement-gate/generate.mjs <id> --title "English title" --title-zh "中文标题"
```

`scripts/pointers.mjs` is copied into the skill. Skills do not import each other.
