# Clause contract

The model extracts every heading, twice, into two files. It does not score risk. Keys are exact.

```json
{
  "schema": "enterprise/clauses/2",
  "origin": "model",
  "source": { "savedAs": "contract.zh.txt" },
  "clauses": [
    {
      "id": "c1",
      "heading": "第1条",
      "kind": "term",
      "value": "三十日",
      "quote": "甲方应于收到发票后三十日内付款。",
      "offset": 4
    }
  ]
}
```

`kind` is `permit`, `forbid`, `obligation`, `term` or `definition`. A cue is optional. When `cue` is present, `predicate` is required, both are spans of `quote`, and only space or a short mark may sit between them. The script does not classify the cue. `value` is a span of `quote`. For a `term`, `value` must parse: digits or a Chinese numeral, then `天` / `日` / `月` (or English `day` / `month`). `天` and `日` are days. `月` is a month. They are not converted.

A one-line `第1条 甲方应于收到发票后三十日内付款。` has heading `第1条`. `第2条 数据` has heading `数据`. `第4条 保密：…` has heading `保密`. `offset` is where `quote` starts in the original. A topic the heading does not match is reported with no default risk. The payment day floor is `minDays` on the pinned policy, not a number in this script.

The two files are independent. A different `kind`, or a different parsed term, is `needs_human`. The script does not pick one, and a third model pass is not a resolver.

`references/risk-policy.json` is approved once. Pin it with `node templates/judgement-gate/pin.mjs <file> --out <pin.json> --approve` after a person has accepted the bytes. The sample floor is 30 days. A company that pins 45 days gets a different score without a code change.
