# Event labels

The model labels lines. It does not compute a duration.

```json
{
  "schema": "enterprise/event-labels/1",
  "origin": "model",
  "source": { "savedAs": ".circle/hub-returns/log.json" },
  "labels": [
    {
      "quote": "2026-09-02T10:00:00Z inc-1 opened synthetic checkout failure",
      "event": "opened",
      "incident": "inc-1"
    }
  ]
}
```

`quote` is one whole line of the server-saved log. The script parses that line again. When the label disagrees with the parse, the parse wins and the disagreement is named. A line that does not match the grammar is reported with `missingFields`, and it is not given an invented event.
