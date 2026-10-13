# Contributing to circle-packs

Thanks for helping. This page is what you need to make a change that can be merged. Everyone taking part follows the [Code of Conduct](CODE_OF_CONDUCT.md).

Read the [README](README.md) and the [APV status page](docs/product-line-pack.md) first. The layout and the adaptation sheet every pack fills in are circle-hub's [product-line pack exemplar](https://github.com/circle-platforms/circle-hub/blob/main/docs/design/product-line-pack.md) ([English](https://github.com/circle-platforms/circle-hub/blob/main/docs/design/en/product-line-pack.md)). The exemplar is the constraint: a product-line pack plugs in at the extension points; everything that plugs in is an asset; taking effect goes through a change set; running goes through the enforcement chain; the platform is not the approver; product content stays out of the circle-hub core. A change that has to go around one of these changes the exemplar in circle-hub first and the pack after.

## Before you start

- **Bugs.** Open an issue with the bug report form. Say the module and its version, what you put in, what you expected and what you saw.
- **Ideas and new packs.** Open an issue first and describe the problem you want solved and the product line it belongs to.
- **Security.** Anything that may involve a vulnerability or sensitive data follows [SECURITY.md](SECURITY.md), not a public issue.
- **The other repositories.** Circle's client lives in [circle](https://github.com/circle-platforms/circle) and the hub in [circle-hub](https://github.com/circle-platforms/circle-hub). This repository holds skill packs and product-line packs only. What the three repositories expect of each other is in circle-hub's [compatibility matrix](https://github.com/circle-platforms/circle-hub/blob/main/docs/compatibility.md).

## Set up

circle-packs needs Node.js 24 or newer and has no dependency manifest of its own. The manifest check and the skill tests run as they are. The product-line pack tests need circle-hub's dependency set: link that checkout's `node_modules` into this repository.

```bash
git clone https://github.com/circle-platforms/circle-packs
cd circle-packs
ln -s <circle-hub-checkout>/node_modules node_modules
```

`<circle-hub-checkout>` is your checkout of circle-hub. Never write a path from your machine into the repository.

## Test

```bash
node tools/modules.ts check
node --test tools/*.test.ts skills/*/tests/*.test.mjs
node --experimental-strip-types --test 'products/apv/tests/*.test.mjs'
```

- Every behaviour change comes with a synthetic sample that reproduces the original problem. Old test records and real returns are not evidence that something works today.
- Acceptance uses synthetic sources and synthetic samples only: no real system, no paid model, no real device.
- Never commit passwords, tokens, internal addresses, business originals, user sessions or absolute paths from your machine.

## Make a change

- Command trees, function contracts, bed configuration, mind-map originals and device returns never enter Git. They are uploaded to circle-hub at run time.
- After changing a file in a module, run `node tools/modules.ts write` to rewrite [modules.json](modules.json), then `node tools/modules.ts check`.
- The English README is the main one; the Chinese one is `README.zh-CN.md`. Interface and code identifiers are English. Keep what is on `main`, what is under review and what is unverified apart.

## Releases

Each module carries its own version in its manifest; `CHANGELOG.md` tracks the repository. Add a line under `## Unreleased` with every change a user would notice. A pack follows the schema version of the circle-hub it is installed on; see the [compatibility matrix](https://github.com/circle-platforms/circle-hub/blob/main/docs/compatibility.md).

## Change the docs

Files in `docs/` describe what the packs do today. If you change behaviour, change the page that mentions it in the same pull request. The pages are published at <https://circle-platforms.github.io/circle-packs/> by `.github/workflows/pages.yml`.

## Commit messages

One short imperative sentence in English, capitalised, with no prefix and no full stop, for example `Record the product question-answering skill in the module list`. Put the why in the pull request. Stage explicit paths; never `git add -A`, `git add .` or `git commit -a`.

## Pull requests

- Keep a pull request to one pack or one change.
- Run the checks and say so in the description: what changed, why, which packs are affected and what was actually verified.
- Sign off every commit (`git commit -s`); see [Contributor terms](#contributor-terms).
- Fill in the checklist in the template.

## Security

Do not open a public issue for a vulnerability. See [SECURITY.md](SECURITY.md).

## Contributor terms

circle-packs is open source today, and the people behind it may later offer it under commercial terms as well, next to the open-source version. So that this stays possible without asking every contributor again, every contribution (code, tests, documentation, procedures, translations, synthetic samples) is accepted on the terms below. There is no separate form to sign: submitting a contribution means you accept them.

### Sign off your commits

Every commit in a pull request carries a `Signed-off-by` line with your real name and an email address you control. `git commit -s` adds it. The line is your certification of the [Developer Certificate of Origin 1.1](https://developercertificate.org/):

- the contribution was created in whole or in part by you, and you have the right to submit it under the licenses of this repository; or
- it is based on previous work that, to the best of your knowledge, is under a compatible open-source license, and you have the right to submit that work, with or without your changes, under the same licenses; or
- it was given to you by someone who certified one of the above, and you have not changed it;
- and you understand that the contribution, with your sign-off, is public and is kept with the project.

A pull request whose commits are not signed off is not merged.

### License to the project

You keep the copyright in your contribution. By submitting it you grant qingshanfeihu, the Circle project and any person or organization that later takes over the maintenance of circle-packs (together, the project owner) a perpetual, worldwide, non-exclusive, royalty-free, irrevocable copyright license, with the right to sublicense through several tiers, to reproduce, prepare derivative works of, publicly display, publicly perform, distribute and otherwise use your contribution and derivative works of it, under the Apache License 2.0 or under any other terms the project owner chooses, including commercial, proprietary and dual-license terms.

You also grant the project owner and every recipient of circle-packs a patent license on the terms of section 3 of the Apache License 2.0 for the patent claims you can license that your contribution infringes by itself or combined with circle-packs.

You confirm that you may grant these rights: if your employer or anyone else holds rights in your work, you have their permission or they have waived those rights. If the contribution includes work by others, say so in the pull request and name the license it comes under. These terms do not transfer your copyright, and they do not oblige the project owner to use your contribution.

If you cannot agree to these terms, do not submit the contribution.

## License

circle-packs' code, procedures and documentation are released under the [Apache License 2.0](LICENSE). The [NOTICE](NOTICE) file names the copyright holder and reserves the Circle and Circle Hub names, logos and icons, which no license here covers. A contribution is released under that license, in addition to the terms above. Until 2026-10-13 the repository was under the MIT License. The repository bundles no third-party components; a pack's tools import only circle-hub's dependency set.
