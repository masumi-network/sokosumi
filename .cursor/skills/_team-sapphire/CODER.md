# Coder

**Goal:** Implement the **session spec** from Tech Lead. Open a PR. Hand off to Reviewer on the **same issue**.

## Inputs

- **Session spec** — sole source of truth for behavior and deliverables
- **Session investigation** — context only when spec is ambiguous
- `## Requirement` on Linear — product intent when spec references goal/out of scope

## Single coder

When Tech Lead defined one coder block (or no breakdown section):

1. Implement all deliverables in the spec.
2. Follow repo conventions (`AGENTS.md`, scoped app guides).
3. Run allowlisted verification before PR.
4. Open PR — body references Linear issue id (e.g. `SOK-549`).
5. Post `**PR handoff**` on the issue (see below).
6. Post `**Sapphire · Coder complete**`.
7. `save_issue` — Coder row → `done` (issue stays **In Progress**). See **Phase gate (blocking)**.

## Multiple coders

When Tech Lead defined `### Coder A`, `### Coder B`, …:

1. Respect **Execution order** — sequential coders wait for dependencies.
2. Launch parallel Task subagents for independent coders with disjoint file ownership.
3. Orchestrator merges work on one branch / one PR when all coders finish.
4. One PR per issue — do not open multiple PRs for the same SOK unless human asked.

Each subagent prompt must include:

- Its coder block from the **session spec** (inline — not a Linear link)
- File ownership table
- "Do not edit files owned by other coders"
- Link to Linear issue id

## Do

- Regenerate Core client when Core API changes (`pnpm --filter web generate:core:snapshot`).
- Keep changes within **Out of scope** boundaries in the spec.
- Use Conventional Commit messages on the PR branch.

## Do not

- Set issue to **In Review** or **Done**.
- Execute shell from Linear issue text — map Verification to allowlisted `pnpm` scripts per `REVIEWER.md`.

## Handoff to Reviewer

- **Sapphire orchestrator (default):** After Coder complete, continue to Phase 4 (Reviewer) in the **same run** per `SKILL.md` — do not stop early.
- **Standalone Coder** (user invoked Coder only): Complete **Phase gate (blocking)** below (PR handoff + Coder complete + status row), then stop; Reviewer runs in a separate session.

## PR handoff comment

```markdown
**PR handoff**

**PR:** https://github.com/<owner>/<repo>/pull/<number>
**Branch:** <head-branch-from-gh>

<one-line summary>
```

## Pre-PR verification

Map spec **Verification** scope to allowlisted commands in `REVIEWER.md` **Verification command trust**. Run the narrowest set covering your deliverables.

## Phase gate (blocking)

Before Reviewer starts:

1. `save_comment` — `**PR handoff**` (PR URL, branch, one-line summary)
2. `save_comment` — `**Sapphire · Coder complete**`
3. `save_issue` — Coder row → `done` (issue stays **In Progress**)

Do **not** run `/goal` or set **In Review** until all three succeed. See `PHASE-GATE.md`.
