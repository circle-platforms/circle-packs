# Triage contract

The model names intent and severity twice, into two files. It does not choose a queue.

```json
{
  "schema": "enterprise/triage-contract/2",
  "origin": "model",
  "source": { "savedAs": "tickets.zh.json" },
  "items": [
    { "id": "t-2", "intent": "account-takeover", "severity": "medium", "quote": "有人在东京登录了我的账号", "offset": 5 }
  ]
}
```

`offset` is the index of `quote` in that ticket's text (`subject`, a newline, then `body`). A file `{ "text": "..." }` is one ticket with id `text`, and `offset` is into that string.

The sample policy floor for `account-takeover` is `critical`. When both extracts agree on a lower severity, the script raises it and records `judgedSeverity` and `floorApplied`. When they disagree, the floor is not used to pick a winner.

An intent that is not in the pinned policy is `needs_human`. The report does not call it P4 and does not assign 1440 minutes.

`references/sla-policy.json` is approved once and pinned. Add an intent or a floor there. Do not put a default severity in the script.
