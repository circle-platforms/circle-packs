# Triage contract

The model names an intent and a severity, and quotes the ticket. It does not choose a queue, a priority, or an SLA. The mapping is the SHA-pinned `references/sla-policy.json`. Do not re-extract it.

```json
{
  "schema": "enterprise/triage-contract/1",
  "origin": "model",
  "source": { "savedAs": ".circle/hub-returns/tickets.json" },
  "items": [
    { "id": "t-2", "intent": "account-takeover", "severity": "critical", "quote": "有人在东京登录了我的账号" }
  ]
}
```

`severity` is `critical`, `high`, `medium`, or `low`. `quote` is a verbatim span of that ticket's subject or body. A numeric `severity` on the ticket file is not the judgement. The script maps the judged severity through the policy (`critical` is P1 and 15 minutes) and maps `intent` to a queue (`account-takeover` is `security-desk`). Every ticket id in the original must appear (`input_not_covered`). A credential-shaped span in the original sends the ticket to `credential-hold`.
