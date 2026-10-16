# Source pointers and approved metrics

The human writes `metrics.yaml` and approves it before the run. The sample shape is `references/metrics.sample.yaml`. The model does not add a metric and does not type a total.

The model writes `sources.contract.json`. Each source is only a pointer:

```json
{
  "schema": "enterprise/sources/1",
  "origin": "model",
  "sources": [{ "savedAs": ".circle/hub-returns/sales.json" }]
}
```

A transcribed row in that file is `pointer_not_transcribe`. The gate loads each return, keeps the rows from those bytes, and sums only kinds named by the approved metrics. A kind the metrics file does not name stops the script.
