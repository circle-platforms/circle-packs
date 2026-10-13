# Security policy

circle-packs is under development and is not a supported production release. Acceptance here runs on synthetic samples. Before you install a pack on any circle-hub that matters, check it against the adaptation sheet and the approvals in the [product-line pack exemplar](https://github.com/circle-platforms/circle-hub/blob/main/docs/design/product-line-pack.md).

## Report a vulnerability

Please do not open a public issue for a security problem.

Use GitHub's private reporting: open the repository's **Security** tab and choose **Report a vulnerability**. If that option is not available, open an issue that says only that you have a security report and ask for a private way to send it. Do not put details in the issue.

Include the pack or script affected, the smallest reproduction, the impact, the module version or the commit, and the files involved. Do not upload passwords, tokens, internal addresses, business originals, device returns or whole user sessions.

Reports are handled on a best-effort basis. There is no guaranteed response time at this stage.

## Supported versions

Fixes go into the latest commit on `main` and the next version of the module. Nothing older is patched; a hub keeps the version it approved until it approves another.

## What counts

These are in scope:

- A tool that is not a pure function on bytes: one that reads the environment, the network or the file system, or imports something outside its declared imports.
- A hook that blocks what is not provably true, or passes what the exemplar says it must block.
- A skill whose declared tools, inputs or origins differ from what it actually does.
- An original (a command tree, a function contract, bed configuration, a mind map, a device return), a credential or an internal address that got into Git. Such a commit is rejected, not redacted and kept.
- Anything that lets text from a source or a tool result change what a pack declares or what the hub approves.

Out of scope, by design: runtime addresses, credentials and certificates are kept by the deployer and registered in circle-hub; this repository only provides the bytes that are installed. How circle-hub approves and executes is in its [approvals and enforcement chain](https://github.com/circle-platforms/circle-hub/blob/main/docs/design/approvals-and-enforcement.md).
