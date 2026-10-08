---
name: steward
description: Sokosumi conventions for driving a pull request to green. Read by path when watching a PR, fixing its CI, or merging main into it.
disable-model-invocation: true
---

# Steward a Sokosumi PR

Conventions live in [`docs/agents/delivery.md`](../../docs/agents/delivery.md): PR title, hooks, required vs advisory checks, preview commands. This file only adds what a PR watcher hits.

Canonical files: `skills/steward/`. Install into agent skill dirs with `npx skills add . --skill steward` (or `npx skills add masumi-network/sokosumi --skill steward` from another clone).

- **Conflicts:** merge `origin/main` into the PR branch; never rebase or force-push. The `post-merge` hook reinstalls when the merge moved `pnpm-lock.yaml`; in a cloud session an old branch may still need a deeper clone ([cloud environment](../../docs/agents/cloud-environment.md#sandbox-facts)).
- **Red check:** only the ruleset's required checks block merge; a red advisory job (`Test CLI`, `Test Local env`, `Test CI config`, `Test Cloud agent db`) is still worth fixing when this PR caused it. For `Xcode test`, read the `Sokosumi-xcresult` bundle as [`apps/apple/AGENTS.md`](../../apps/apple/AGENTS.md) describes.
- **`/deploy` fails with "owned by another workflow":** the branch carried an earlier PR whose preview env vars still exist. Dispatch `Preview deploy` to reconcile, then retry; use a new branch for the next PR.
- **Merge:** a human merges. Mark the PR ready only when CI is green and the change is complete.
