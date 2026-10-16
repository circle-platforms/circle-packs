# Triage contract

The model names an intent and quotes the ticket. It does not choose a queue or an SLA.

```json
{
  "schema": "enterprise/triage-contract/1",
  "origin": "model",
  "source": { "savedAs": ".circle/hub-returns/tickets.json" },
  "items": [
    { "id": "t-1", "intent": "outage", "quote": "Checkout down" }
  ]
}
```

`quote` is a verbatim span of that ticket's subject or body in the server-saved file. The script looks the id up in that file, assigns the queue and response minutes from `references/sla-policy.json`, recomputes priority from severity and tier, and holds the ticket when the original contains a credential.
