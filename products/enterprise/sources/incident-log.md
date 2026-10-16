# Original role: incident-log

- File: UTF-8 text, one event per line: `2026-09-02T10:00:00Z inc-1 opened synthetic checkout failure`.
- The verb is `opened`, `acknowledged`, `mitigated` or `resolved`. Times are UTC with a `Z` suffix and no fractional seconds.
- Metadata to declare at upload: `service` (a synthetic label such as `example-checkout`).
- MTTR is the mean of `resolved - opened` in minutes. An incident missing either mark is incomplete and is not averaged in.
