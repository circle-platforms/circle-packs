# Policy rules

The model extracts rules from the saved manual. It does not decide an access request. Approve the file once and pin its SHA for later runs; do not re-extract the table every time.

```json
{
  "schema": "enterprise/policy-rules/1",
  "origin": "model",
  "source": { "savedAs": "policy.zh.txt" },
  "rules": [
    {
      "id": "r1",
      "effect": "permit",
      "role": "账本只读",
      "cue": "可以",
      "minTenureMonths": 6,
      "quote": "入职满6个月的员工可以申请账本只读。"
    },
    {
      "id": "r2",
      "effect": "downgrade",
      "role": "账本管理员",
      "grant": "账本只读",
      "cue": "降为",
      "quote": "账本管理员应降为账本只读，不得直接开通管理员。"
    }
  ]
}
```

`effect` is `permit`, `forbid`, or `downgrade`. `cue` is a polarity span of `quote` and must match the effect (`降为` is `downgrade`). `minTenureMonths` is optional on a permit and the digits must appear in the quote. `grant` is the role a downgrade actually gives, and it must appear in the quote. `role` is a span of `quote`.

The script compares `request.tenureMonths` with `minTenureMonths`. A short tenure is `tenure_short`. A downgrade returns `grant` instead of the requested admin role.
