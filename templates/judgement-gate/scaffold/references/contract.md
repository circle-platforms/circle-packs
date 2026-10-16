# Judgement contract

The model writes this file. The gate reads it. Keys are exact.

```json
{
  "schema": "circle-packs/judgement-contract/1",
  "origin": "model",
  "items": [
    {
      "id": "i1",
      "quote": "verbatim span of the server-saved original",
      "source": { "savedAs": ".circle/hub-returns/example.json" }
    }
  ]
}
```

`source` has one key, `savedAs`. A file that also carries `result`, `contentBase64`, or `text` is a transcription, and the gate refuses it with `pointer_not_transcribe`.

The gate loads the hub return the pointer names, checks `quote` is a substring of that return, and keeps the return's evidence id. The model does not write the evidence id.
