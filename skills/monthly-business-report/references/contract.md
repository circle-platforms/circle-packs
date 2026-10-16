# Header map

The model maps headers, twice. It does not copy cells. The metric list is the human-approved `metrics.yaml`, pinned by SHA.

```json
{
  "schema": "enterprise/header-map/1",
  "origin": "model",
  "sources": [
    {
      "name": "ledger",
      "columns": { "date": "记账日期", "account": "部门", "kind": "摘要", "amount": "发生额" },
      "source": { "savedAs": "ledger.zh.csv" }
    }
  ]
}
```

`source` is only `{"savedAs"}`. The file is raw CSV. `columns` names header cells, whatever those cells are called. A value that is not a header fails with `header_not_in_source`.

The two files must name the same headers. A difference is `needs_human` and the script writes no total.

Rows are kept only when the date is in the pinned period, the amount is a non-negative number, and the kind is an approved `match` (`收入` → `revenue` when the pinned metrics say so). Other rows are listed with a reason: `outside_period`, `bad_date`, `empty_amount`, `negative_amount`, `bad_amount`, `unapproved_kind`. An empty amount is a reject, not zero.

`reconcile.accepted` is the kept sum. `reconcile.rejectedNumeric` is the sum of rejected amounts that are positive numbers. `reconcile.naivePositive` is those two added. The sample ledger keeps `16426400` and the naive positive sum is `16524799`.
