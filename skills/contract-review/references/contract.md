# Clause contract

The model extracts clauses. It does not score them. Keys are exact.

```json
{
  "schema": "enterprise/clauses/1",
  "origin": "model",
  "source": { "savedAs": ".circle/hub-returns/contract.json" },
  "clauses": [
    {
      "id": "c1",
      "heading": "Payment terms",
      "effect": "permit",
      "value": "30 days",
      "quote": "Payment is due within 30 days of invoice.",
      "source": { "savedAs": ".circle/hub-returns/contract.json" }
    }
  ]
}
```

`effect` is `permit` or `forbid`. `value` is a span inside `quote`. `quote` is a span of that heading's section in the server-saved contract. `source` is only the pointer.

Risk comes from `references/risk-policy.json`. A required heading the source does not contain is `missing`, scored by the policy, and named in the report.
