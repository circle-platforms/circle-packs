# Source contract

The model maps headers. It does not copy cells. The metric list is the human-approved `metrics.yaml`, pinned by SHA. Do not re-extract it.

```json
{
  "schema": "enterprise/sources/2",
  "origin": "model",
  "sources": [
    {
      "name": "sales",
      "columns": { "account": "账户", "kind": "类型", "amount": "金额" },
      "source": { "savedAs": "sales.csv" }
    }
  ]
}
```

`source` is only `{"savedAs"}`. The file is raw CSV, either a user-provided local file or a hub return whose `contentBase64` is that CSV. `columns` names header cells. A value that is not a header, including a data cell such as `120`, fails with `header_not_in_source`. The script parses every data row and maps the kind cell through the approved `match` list (`收入` → `revenue`).
