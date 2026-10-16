# Clause contract

The model extracts every heading. It does not score risk. Keys are exact.

```json
{
  "schema": "enterprise/clauses/1",
  "origin": "model",
  "source": { "savedAs": ".circle/hub-returns/contract.json" },
  "clauses": [
    {
      "id": "c1",
      "heading": "付款期限",
      "effect": "permit",
      "cue": "应",
      "value": "10日",
      "quote": "甲方应于收到发票后10日内付款。",
      "source": { "savedAs": ".circle/hub-returns/contract.json" }
    }
  ]
}
```

A heading is a Markdown heading, a `1.` / `1、` line, or `第N条` (digits or 一二三…). `heading` is the title after that marker, such as `付款期限` or `Payment terms`. `quote` is a span of that section. `value` is a span of `quote`. `cue` is a polarity span of `quote` (`不得` / `禁止` / `不` / `可` / `应`, or `shall not` / `may` / `shall`). The script checks that the cue's polarity is the `effect`. Flipping `permit` and `forbid` while leaving the quote and cue unchanged fails with `polarity_mismatch`.

`source` is only the pointer. It may name a hub return or a user-provided UTF-8 file. Every heading in the original must appear in `clauses` (`input_not_covered` otherwise).

Risk comes from the SHA-pinned `references/risk-policy.json`. Do not re-extract that table. A required topic the source does not contain is `missing`. Ten-day payment is high. Thirty-day payment is low. `不向关联方共享` with cue `不` is a forbid of sharing and scores low.
