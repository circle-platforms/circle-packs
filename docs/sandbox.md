---
nav_order: 4
---

# macOS sandbox warning

circle-hub runs a frozen product-line tool or hook inside a process isolation adapter. The adapter in circle-hub today is macOS only. On any other platform, including Linux, `isolatedProcess` throws before the tool runs:

```text
SANDBOX_UNAVAILABLE
This execution host has no supported process isolation adapter
```

That is `packages/runtime/src/isolation.ts`: the function returns this error when `process.platform` is not `darwin`. On macOS, a host that does not have `/usr/bin/sandbox-exec` gets the same code with the message `Process isolation is unavailable`.

This is the hub's process sandbox. It is not the Chromium sandbox a desktop Circle build prints about, and it is not a skill script you start yourself with `node`.

A Linux `dev:stack` hub can still serve the API, check a module catalogue, and install a skill or a product line. It cannot execute a frozen tool or hook until circle-hub ships a Linux isolation adapter. That adapter is hub work. This repository does not add one, and a pack cannot turn the warning off.

Until that adapter exists, run frozen tools on a macOS execution host. Skill scripts under `skills/<id>/scripts/` remain ordinary local Node when you run them in a checkout; they are the script step of a skill, not a substitute for the hub sandbox.
