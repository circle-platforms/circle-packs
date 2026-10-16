# Original role: business-extract

- File: one UTF-8 JSON extract, either a single source `{name, rows:[{account, kind, amount}]}` or a bundle `{period, sources:[...]}`.
- `kind` is `revenue` or `expense`. `amount` is a finite number. Names use letters, digits, space, `.`, `_` and `-`.
- Metadata to declare at upload: `period` (for example `2026-09`) and `source` (for example `sales`).
- Several extracts are aggregated by the monthly-report skill. Addresses, if a row ever needs one, use 192.0.2.0/24. No live ledger belongs in Git.
