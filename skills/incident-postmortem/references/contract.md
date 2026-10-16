# Event labels

The model labels every non-empty line. It does not compute MTTR. The start and end events are the SHA-pinned `references/incident-policy.json` (`opened` and `resolved`). Do not re-extract that definition.

```json
{
  "schema": "enterprise/event-labels/1",
  "origin": "model",
  "source": { "savedAs": ".circle/hub-returns/log.json" },
  "labels": [
    {
      "quote": "[2026-09-02 19:00 JST] inc-1 客服：用户无法登录",
      "incident": "inc-1",
      "event": "opened",
      "at": "2026-09-02 19:00 JST"
    }
  ]
}
```

`quote` is one whole line of the original. `incident` and `at` are spans of that line. `at` may be UTC (`Z`), a numeric offset (`+08:00`), or a named zone in the pinned policy (`JST`, `CST`). `event` is the model's label and is one of the policy's events. The script does not replace that label with a line grammar. It converts `at` to UTC and computes minutes from the pinned start event to the pinned end event.

Every non-empty line must have a label (`input_not_covered`). An incident missing the start or end event fails the gate with `metrics_missing` and the field names. The gate does not pass with MTTR `none`.
