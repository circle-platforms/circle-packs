---
name: local-script
description: Summarise one hub document by running this skill's local script. Use when learning the circle-hub skill manifest, declared tools, outputs and trial record.
titleZh: 本地脚本示例
---

# Local script example

Circle binding: Circle 1.7.0 or newer uses the `hub` extension, `/hub login` and `hub_tool_*`. Other harnesses expose the declared remote tools through their own adapters. Former Circle extension, command and tool names are not aliases.

The pack directory is `skills/local-script/`. Keep it there. A module file whose path has a segment starting with `.` is rejected, so this skill is not shipped inside a hidden harness directory. Hub-saved tool returns live under `.circle/hub-returns/` at run time; that directory is not part of the pack.

## Inputs

- `file`: a document path on the documents connector.
- circle-hub tool: `hub_tool_docs_get`. If it is missing, say so and stop. Do not read the file from memory.

## 1. Read the document (tool)

Call `hub_tool_docs_get` with `{file}`. The hub saves the return and the result carries `savedAs`. Pass that pointer to the script. Do not transcribe the bytes.

## 2. Summarise (script)

```
node <skill>/scripts/summarise.mjs <folder> --get <hub-saved return or {savedAs} pointer>
```

The script decodes `result.contentBase64` as UTF-8, counts non-empty lines and whitespace-separated words, and writes `<folder>/out/summary.json`:

```json
{ "lineCount": 2, "wordCount": 3, "origin": "script" }
```

There is no judgement step. The only declared output is `out/summary.json`. A run that writes a different path does not satisfy the manifest.

The shape of a trial record, and the three mismatches that usually reject one, are in [docs/local-script.md](../../docs/local-script.md). `references/trial.json` is a synthetic sample of that shape, not a record that a trial ran.
