# Access rules

The first run extracts every rule twice. A person approves one file. Later runs load that file and do not extract again.

```json
{
  "schema": "enterprise/policy-rules/2",
  "origin": "approved",
  "source": { "savedAs": "policy.zh.txt" },
  "rules": [
    {
      "id": "r1",
      "effect": "permit",
      "kind": "obligation",
      "role": "账本:只读",
      "quote": "需入职满30天可以申请账本:只读，由直属经理批准。",
      "offset": 0,
      "minTenure": { "value": 30, "unit": "day" },
      "approver": "直属经理"
    }
  ]
}
```

`effect` is `permit`, `forbid`, or `downgrade`. `kind` may be `obligation` when the sentence is a requirement (`需入职满30天`) and there is no polarity word to cite. `minTenure` and `after` are `{value, unit}` with `unit` `day` or `month`. The quote must parse to that same value and unit. `天` and `日` are days. `月` is a month. `90天` does not satisfy a month rule.

`role` and `grant` may contain colons. `approver` is a span of the quote. A downgrade sets `after` and `grant`. The same offset and quote cannot be both `permit` and `forbid`.

A request carries `tenure` in the same shape and a `startDate` of `YYYY-MM-DD`. The grant date is that start plus the waiting days. `2026-09-01` plus 30 days is `2026-10-01`.

Compare the two extracts before anyone approves them:

```
node scripts/gate.mjs <folder> --left rules.left.json --right rules.right.json
```

Pin the approved file with `node templates/judgement-gate/pin.mjs`. The gate compares `--pin` to the file and refuses a mismatch.
