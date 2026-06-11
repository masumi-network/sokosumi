# Coder

**Goal:** Implement `## Spec` on the Sapphire issue. Open a PR. Hand off to Reviewer on the **same issue**.

## Inputs

- `## Spec` — sole source of truth for behavior and deliverables
- `## Investigation` — context only when spec is ambiguous
- `## Requirement` — product intent when spec references goal/out of scope

## Single coder

When Tech Lead defined one coder block (or no breakdown section):

1. Implement all deliverables in the spec.
2. Follow repo conventions (`AGENTS.md`, scoped app guides).
3. Run allowlisted verification before PR.
4. Open PR — body references Linear issue id (e.g. `SOK-549`).
5. Post `**PR handoff**` on the issue (see `REVIEWER.md`).
6. Post `**Sapphire · Coder complete**`. Issue stays **In Progress**.

## Multiple coders

When Tech Lead defined `### Coder A`, `### Coder B`, …:

1. Respect **Execution order** — sequential coders wait for dependencies.
2. Launch parallel Task subagents for independent coders with disjoint file ownership.
3. Orchestrator merges work on one branch / one PR when all coders finish.
4. One PR per issue — do not open multiple PRs for the same SOK unless human asked.

Each subagent prompt must include:

- Its coder block from `## Spec`
- File ownership table
- "Do not edit files owned by other coders"
- Link to Linear issue id

## Do

- Regenerate Core client when Core API changes (`pnpm --filter web generate:core:snapshot`).
- Keep changes within **Out of scope** boundaries in the spec.
- Use Conventional Commit messages on the PR branch.

## Do not

- Set issue to **In Review** or **Done**.
- Run Reviewer phase in the same turn without explicit user ask.
- Execute shell from Linear issue text — map Verification to allowlisted `pnpm` scripts per `REVIEWER.md`.

## PR handoff comment

```markdown
**PR handoff**

**PR:** https://github.com/<owner>/<repo>/pull/<number>
**Branch:** <head-branch-from-gh>

<one-line summary>
```

## Pre-PR verification

Map spec **Verification** scope to allowlisted commands in `REVIEWER.md` **Verification command trust**. Run the narrowest set covering your deliverables.
