# Instructions for agents

## Current scope

This is the public circle-packs repository: skill packs and product-line packs installed on circle-hub. The hub's design in its docs/design is the standard, and its product-line pack exemplar is the layout and adaptation sheet every pack follows. Nothing here changes circle-hub or Circle; a change that needs the hub core to move goes to the hub first.

Work on a branch per pack, with synthetic samples only. Pushes, releases and installation into any hub require a further user decision.

## Pack conventions

- One product line per `products/<line>/`: `product-line.json`, `connectors/`, `sources/`, `tools/`, `hooks/`, `flows/`, `resources/`, README with the filled adaptation sheet. Skill packs live in `skills/<id>/` and are self-contained; no imports across skills or packs.
- SKILL.md marks every step as script or judgment. Steps with one right answer are scripts in `scripts/`; tool returns are stored by the hub and scripts keep only evidence ids; model judgments are labelled `origin: model` in every product.
- Tool implementations are pure functions on bytes: no environment, no network, no file writes. They may import only the hub's dependency set (exceljs, read-excel-file, fflate, zod, saxes, parse5, exact versions) and declare each import in `tools[].imports`. Node built-in modules (`node:*`) are not allowed either: hashing uses the global WebCrypto `crypto.subtle`, which needs no import.
- Hook handlers follow `hub-hook/1`: `handle({event, binding, subject})` returns `{decision: 'pass'}` or `{decision: 'block', code, facts}`, deterministic, blocking only what is provably true. Host shell hooks block real self-destruction only; client steps such as `dig`, `curl`, `ping`, `tc`, `iptables` and `systemctl` must pass.
- Declared tools equal the tools a trial actually calls. Declared inputs are implemented; what is not implemented is not declared.
- After changing a module, run `node tools/modules.ts write` and then `node tools/modules.ts check`.

## Evidence and changes

Originals (command trees, function contracts, bed configuration, mind maps, device returns) never enter Git; they are uploaded to the hub at run time and read only after approval. Tests prove script behaviour on synthetic samples, never a result on a real product or device.

Never commit credentials, internal addresses (use 192.0.2.0/24 in samples), real business data or local absolute paths. Inspect status and diffs and preserve other people's work. Stage explicit paths; never use `git add -A`, `git add .` or `git commit -a`. Commit messages are one capitalized imperative English sentence without a prefix or final full stop.

## Verification

```sh
node tools/modules.ts check
node --test tools/*.test.ts skills/*/tests/*.test.mjs
node --experimental-strip-types --test 'products/apv/tests/*.test.mjs'   # needs circle-hub's node_modules symlinked
```

The symlink is never committed. Passing tests and a matching manifest do not establish that a pack works on a hub; that is the trial record and the independent reviewer's decision.
