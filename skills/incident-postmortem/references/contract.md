# Event labels

The model labels every non-empty line, twice, into two files. It does not compute a duration.

```json
{
  "schema": "enterprise/event-labels/2",
  "origin": "model",
  "source": { "savedAs": "log.zh.txt" },
  "labels": [
    {
      "quote": "[19:00 JST] 客服：用户无法登录",
      "offset": 11,
      "event": "opened",
      "incident": "inc-1",
      "at": "19:00 JST",
      "dateFrom": { "quote": "2026-09-02", "offset": 0 }
    }
  ]
}
```

`incident` is optional. It is not required to be a span of `quote`. `event` includes `other`, which needs no clock and no incident id. `at` must include a zone (`Z`, `+08:00`, `JST`, `CST`, `UTC`, `GMT`). A timestamp with no zone fails `zone_missing` and is not read as UTC. A clock with no date fails `date_missing` unless `dateFrom` quotes an earlier `YYYY-MM-DD` in the same file. The script records that assumed date on the event.

The same incident and event twice, or the same offset twice, fails `duplicate_label`.

`references/incident-policy.json` pins two metrics: `alert` is opened to resolved, and `customerImpact` is impact-start to impact-end. The sample log is 40 minutes of alert and 45 minutes of customer impact. Do not report the alert duration as the only figure.

A different `event`, incident id, or `at` between the two files is `needs_human`. The script does not pick one.
