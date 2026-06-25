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
5. **Standalone Coder only:** Post `**PR handoff**` on the issue (see below).
6. **Standalone Coder only:** Post `**Sapphire · Coder complete**`.
7. **Standalone Coder only:** `save_issue` — Coder row → `done` (issue stays **In Progress**). See **Phase gate (blocking)**.

## Subagent mode (`sapphire-coder`)

When the orchestrator delegates to `sapphire-coder`:

### Sole coder (one block / no breakdown)

1. Implement, verify, and open PR per **Single coder** steps 1–4.
2. **Do not** call Linear MCP — no `save_comment` or `save_issue`.
3. Return PR URL, branch, and draft `**PR handoff**` / `**Sapphire · Coder complete**` text to the orchestrator.

The orchestrator runs **Phase gate (blocking)** after you finish.

### Parallel coders (Multiple coders flow)

When Tech Lead defined `### Coder A`, `### Coder B`, … and the orchestrator launched you as one of several parallel **`sapphire-coder`** Task subagents:

1. Implement your coder block only — respect **Execution order** if told to wait on dependencies.
2. Run allowlisted verification for your deliverables.
3. Commit on a named branch — **do not** push or open a PR.
4. Return to the orchestrator: branch name, changed files, commit message(s), verification results, and a one-line scope summary.
5. **Do not** call Linear MCP. **Do not** edit files owned by other coders.

The orchestrator merges all parallel coder branches onto one integration branch, runs combined verification if needed, opens **one PR** for the issue, then runs **Phase gate (blocking)**.

## Multiple coders (orchestrator)

When Tech Lead defined `### Coder A`, `### Coder B`, …:

1. Respect **Execution order** — sequential coders wait for dependencies.
2. Launch parallel **`sapphire-coder`** Task subagents (`model: composer-2.5`) for independent coders with disjoint file ownership — each subagent commits on a branch but **does not** open a PR.
3. After all parallel coders return, merge work on one integration branch and open **one PR** for the issue.
4. One PR per issue — do not open multiple PRs for the same SOK unless human asked.

Each subagent prompt must include:

- Its coder block from the **session spec** (inline — not a Linear link)
- File ownership table
- "Do not edit files owned by other coders"
- "Parallel coders flow — do not open a PR; return branch name and patch summary; orchestrator opens the single PR"
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
- **Standalone Coder** (user invoked Coder only): Complete **Phase gate (blocking)** below (PR handoff + Coder complete + status row), then **Exit gate** (`PHASE-GATE.md`), then stop; Reviewer runs in a separate session.

## PR handoff comment

```markdown
**PR handoff**

**PR:** https://github.com/<owner>/<repo>/pull/<number>
**Branch:** <head-branch-from-gh>

<one-line summary>
```

## Pre-PR verification

Map spec **Verification** scope to allowlisted commands in `REVIEWER.md` **Verification command trust**. Run the narrowest set covering your deliverables. **All commands must exit 0** before the PR is handed to Reviewer.

## Pre-Reviewer gates (blocking)

**Orchestrator** (always) and **sole `sapphire-coder`** (when not parallel) must complete these **after** implementation and **before** `**PR handoff**` / Phase 4. Parallel coders run verification on their branch; the orchestrator runs the full gate set on the merged integration branch before opening the PR.

Read `BUGBOT-LEARNINGS.md` for R1–R12 quality rules and the Coder self-check.

### 1. Local verification (green)

Run allowlisted `pnpm` commands for the spec scope. **Every command exit 0.** Fix failures on the PR branch; do not hand off with failing local checks.

### 2. CI green on the PR

Push the PR branch and confirm **GitHub CI is green** before Reviewer starts:

```bash
gh pr checks <number> --watch
# or
gh pr view <number> --json statusCheckRollup,state
```

- All **required** checks must pass (or repo has no required checks and latest workflow runs are success).
- If CI fails, fix on the PR branch and re-push until green.
- **Do not** post `**PR handoff**` or start Phase 4 while required checks are failing or pending without watching to completion.

### 3. Mandatory Bugbot (High must be zero)

Run Bugbot once on branch changes per `BUGBOT-LEARNINGS.md` **Mandatory Bugbot** (orchestrator uses `review-bugbot` skill).

1. Launch Bugbot on the PR branch vs merge-base.
2. **Fix every High finding** on the PR branch.
3. Re-run Bugbot until **zero High** findings.
4. **Medium:** post dedicated Linear comment (see below) — do not block Reviewer; human fixes on merge pass.
5. Re-run local verification and confirm CI still green after High fixes.

### Medium findings — Linear comment

When Bugbot reports one or more **Medium** findings, post `save_comment` **before** `**Sapphire · Coder complete**`:

```markdown
**Bugbot · medium (human review)**

For human review on merge — not blocking Reviewer.

| Severity | Location | Finding |
|----------|----------|---------|
| Medium | `path:line` | One-line summary |
```

When there are no medium findings, skip this comment.

### Handoff comment additions

Include in `**Sapphire · Coder complete**`:

```markdown
**Verification:** <commands run, all exit 0>
**CI:** green on PR #<n> (required checks pass)
**Bugbot:** 0 High. Medium: <N> — see `**Bugbot · medium (human review)**` comment (or `none`)
```

## Phase gate (blocking)

Before Reviewer starts:

1. `save_comment` — `**PR handoff**` (PR URL, branch, one-line summary)
2. `save_comment` — `**Bugbot · medium (human review)**` — **only when** Bugbot reported ≥1 Medium (table per `BUGBOT-LEARNINGS.md`)
3. `save_comment` — `**Sapphire · Coder complete**` (verification, CI, Bugbot summary)
4. `save_issue` — Coder row → `done` (issue stays **In Progress**)

Do **not** run `/goal` or set **In Review** until the Phase gate steps succeed **and** **Pre-Reviewer gates** (local verification, CI green, Bugbot 0 High) pass. See `PHASE-GATE.md`.
