---
nav_order: 3
---

# Local script example

`skills/local-script` is a skill whose only judgement-free step is a script in that skill's own `scripts/` directory. It exists so a manifest, a declared tool, an output path and a trial record can be checked against circle-hub without guessing. The sample is synthetic. It is not a record that a trial ran on a hub.

## Manifest

`skills/local-script/skillpack.json` is a `SkillManifest`. The hub parses it with a strict object, so the keys are exactly these:

| Key | This example |
|---|---|
| `id` | `local-script`, the same as the directory name |
| `version` | `1.0.0` |
| `title` | `Local script example` (English) |
| `owner` | `enterprise` |
| `tools` | `["docs.get"]` |
| `triggers` | `["manual"]` |
| `inputs` | one described input, `file` |
| `outputs` | `["out/summary.json"]` |
| `model` | a sentence; the counts are a script |

The catalogue name is `docs.get`. Circle 1.7.0 shows that same tool as `hub_tool_docs_get` after `/hub login`. The manifest does not use the `hub_tool_` prefix.

Chinese titles are not a field of `SkillManifest`. `titleZh` in `skillpack.json` is an unknown key and the strict parse rejects the file. Put the Chinese title in the `SKILL.md` frontmatter:

```yaml
---
name: local-script
description: Summarise one hub document by running this skill's local script.
titleZh: 本地脚本示例
---
```

`product-line.json` is also strict (`ProductLineManifest`) and has no `title` or `titleZh`. A flow file is not that manifest, so `flows/*.json` may carry both `title` and `titleZh`.

## Declared tools and the script

The skill calls one tool, `docs.get`, and then:

```sh
node skills/local-script/scripts/summarise.mjs <folder> --get <hub-saved return or {savedAs} pointer>
```

The script reads the saved return, decodes `contentBase64`, and writes `<folder>/out/summary.json`. It does not choose a different filename. For the fixture text `alpha beta\ngamma\n` the file is:

```json
{
  "lineCount": 2,
  "wordCount": 3,
  "origin": "script"
}
```

## Trial record

`skills/local-script/references/trial.json` is the shape `SkillPackSubmission.trial` accepts. Both objects are strict. Extra keys fail the parse.

```json
{
  "toolCalls": [
    {
      "name": "docs.get",
      "argsSha256": "8575af288156d885107a88909deb44452170034b25d95b9a0c052b3dd6b59275",
      "ok": true
    }
  ],
  "outputs": [
    {
      "path": "out/summary.json",
      "sha256": "825827ec477151e9bb9ae6fb5b85b9be885011b66cbd9993520d617871841d76"
    }
  ]
}
```

`argsSha256` is the SHA-256 of the canonical JSON of the tool arguments. Canonical JSON sorts object keys, omits `undefined`, and puts no spaces between tokens. For `{"file":"sources/synthetic-note.txt"}` that digest is `8575af288156d885107a88909deb44452170034b25d95b9a0c052b3dd6b59275`. `outputs[0].sha256` is the SHA-256 of the summary file bytes, including the trailing newline the script writes. `outputs[0].path` is exactly the manifest output `out/summary.json`.

## Three rounds that reject a skill

These are the three mismatches that usually take more than one attempt. Each one fails a different check.

1. **The file the hub parses is not the manifest it expects.** `titleZh` on `skillpack.json`, any other unknown key, or a path segment that starts with `.` is rejected before a trial is considered. `ModuleEntry` refuses a module file whose path has a hidden segment, so the skill directory is `skills/local-script/`, not a hidden harness folder. The hub still derives an internal Circle view by prefixing `.claude/skills/<id>/` onto bytes it already accepted; that prefix is not a path this repository ships. Catalogue names in `tools` are `docs.get`, not `hub_tool_docs_get`.
2. **The trial and the declared tools disagree.** A trial call whose `name` is not in `manifest.tools` is `SKILLPACK_CHECK_FAILED` with that name in `undeclaredTools`. A name that is declared but absent from the caller's tool catalogue is reported in `missingTools`. Submit may allow a missing catalogue tool (`allowMissing`); approval and run do not.
3. **The outputs are not the declared paths.** The trial object lists `{path, sha256}` for each file the run returned. At run time the hub requires the returned paths to be exactly `manifest.outputs` (same set, no extras, no omissions) and otherwise returns `EVIDENCE_INSUFFICIENT` with the message `Declared runtime outputs are incomplete`. A sample that adds a field, a second output, or a different relative path fails for this reason even when the script itself is fine.

`node skills/local-script/tests/summarise.test.mjs` checks the fixture counts and that `references/trial.json` matches those two digests.
