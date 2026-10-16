---
name: __ID__
description: Judgement writes a schema'd contract with verbatim quotes. Scripts gate that contract against the server-saved original and emit the result. Use when scaffolding a circle-hub skill on the judgement-gate template.
titleZh: __TITLE_ZH__
---

# __TITLE__

Circle binding: Circle 1.7.0 or newer uses the `hub` extension, `/hub login` and `hub_tool_*`. Other harnesses expose the declared remote tools through their own adapters. Former Circle extension, command and tool names are not aliases.

This skill was generated from `templates/judgement-gate`. Replace the generic contract with the domain file, and replace `scripts/gate.mjs` and `scripts/emit.mjs` with the domain checks. Keep `scripts/pointers.mjs` as the generator wrote it.

## Inputs

- `file`: a document on the documents connector.
- circle-hub tool: `__TOOL_HUB__`. If it is missing, say so and stop.

## 1. Read the source (tool)

Call `__TOOL_HUB__`. Keep the `savedAs` pointer. Do not paste the return into the contract.

## 2. Judgement

Write `<folder>/contract.json`. The shape is in `references/contract.md`. Every quote is a verbatim span of the server-saved original. `source` is only `{"savedAs":"<path>"}`.

## 3. Gate (script)

```
node <skill>/scripts/gate.mjs <folder> --contract <folder>/contract.json
```

The script checks the schema, refuses a transcribed return, checks each quote against the file the pointer names, and records that file's evidence id. It writes `<folder>/gate.json`.

## 4. Emit (script)

```
node <skill>/scripts/emit.mjs <folder> --contract <folder>/contract.json
```

Emit recomputes `out/summary.json` from `gate.json`. It refuses the run when the contract bytes changed after the gate.
