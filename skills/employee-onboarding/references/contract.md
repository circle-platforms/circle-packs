# Policy rules

The model extracts rules from the saved manual section. It does not decide an access request.

```json
{
  "schema": "enterprise/policy-rules/1",
  "origin": "model",
  "source": { "savedAs": ".circle/hub-returns/policy.json" },
  "rules": [
    {
      "id": "r1",
      "effect": "permit",
      "role": "employee-mail",
      "quote": "Starter role employee-mail is granted with the account."
    }
  ]
}
```

`effect` is `permit` or `forbid`. `role` is a span of `quote`. `quote` is a span of the server-saved section. The script evaluates each requested role against these rules after the quotes pass.
