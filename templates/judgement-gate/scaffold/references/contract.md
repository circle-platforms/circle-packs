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

The gate loads the file the pointer names. That file is either a hub `docs.get` / `docs.section` return or a user-provided UTF-8 file at a safe relative path. It checks `quote` is a substring of that original, keeps a hub return's evidence id, and refuses the run when any input item is missing from the contract. A JSON original with an `id` on each of `items`, `tickets` or `rows` is covered by those ids. Any other text is covered line by line. The model does not write the evidence id.
