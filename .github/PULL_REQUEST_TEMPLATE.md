## What and why

<!-- One paragraph. The problem, then what this changes. Link the issue if there is one. Say which packs are affected. -->

## How it was checked

- [ ] `node tools/modules.ts write` was run after changing a module, and `node tools/modules.ts check` passes
- [ ] `node --test tools/*.test.ts skills/*/tests/*.test.mjs` passes, and the product-line pack tests pass with circle-hub's dependency set
- [ ] Every commit is signed off (`git commit -s`), as the contributor terms in CONTRIBUTING.md require
- [ ] Tests use synthetic samples only; no command tree, function contract, device return or business original is in the change
- [ ] A change a user would notice has a line under `## Unreleased` in `CHANGELOG.md`

<!-- The product-line pack exemplar in circle-hub's docs/design is the layout every pack follows. A change that needs the hub core to move goes to the hub first. -->
