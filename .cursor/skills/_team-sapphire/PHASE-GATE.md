# Phase gates (blocking)

Every Sapphire phase ends with **mandatory Linear writes**. These are not optional audit niceties — they are **hard gates**.

**Do not start the next phase until the current phase gate passes.**

## Two writes per phase

| Step | Tool | Purpose |
|------|------|---------|
| 1 | `save_comment` | Phase summary with exact header (see table below) |
| 2 | `save_issue` | Update `## Sapphire status` row → `done` (status-only merge per `LINEAR-MCP.md`) |

Coder uses **three or four comments** plus status: (1) `save_comment` → `**PR handoff**`, (2) optional `save_comment` → `**Bugbot · medium (human review)**` when Bugbot reported ≥1 Medium, (3) `save_comment` → `**Sapphire · Coder complete**`, (4) `save_issue` → Coder row `done`.

**Pre-Reviewer gates** (blocking — before step 1 above or before Phase 4):

1. Local allowlisted verification — all exit 0
2. **CI green** on the PR (`gh pr checks` / required checks pass)
3. **Bugbot** — run once; **fix all High**; re-run until 0 High; post `**Bugbot · medium (human review)**` Linear comment when ≥1 Medium (human fixes on merge pass)

See `CODER.md` and `BUGBOT-LEARNINGS.md`. Do not post `**PR handoff**` or start Reviewer until all three pass.

Reviewer adds a state write **after** status table is saved: `save_issue` with `state: "In Review"` only (no `description`).

## Gate table

| Phase | Required comment header(s) | Status row after gate |
|-------|---------------------------|------------------------|
| Investigator | `**Sapphire · Investigator complete**` | Investigator → `done` |
| Tech Lead | `**Sapphire · Tech Lead complete**` | Tech Lead → `done` |
| Coder | `**PR handoff**`; optional `**Bugbot · medium (human review)**`; `**Sapphire · Coder complete**` | Coder → `done` |
| Reviewer | `**Sapphire · Reviewer complete**` (or `**Sapphire · Review failed**` while looping) | Reviewer → `done` + `state: "In Review"` on pass |

Comment headers must match **exactly** (including bold markers). Summaries belong in the comment body — not only in the Cloud Agent thread.

## Anti-pattern: batch-at-end

**Failed run example (SOK-569):** Agent implemented code, opened PR, set **In Review**, and posted one final summary — but skipped Investigator / Tech Lead / Coder comments and left the status table on `pending`.

That breaks resume, hides progress from humans, and makes runs incomparable to good runs (e.g. SOK-568).

**Never:**

- Defer all `save_comment` / status updates to the end of the session
- Rely on the Cursor agent thread as the only audit trail
- Set **In Review** while status rows still say `pending`
- Post only `**Sapphire · Reviewer complete**` when earlier phase comments are missing

**If you catch yourself coding before Investigator gate passed:** stop, run the missing gates in order, then continue.

## Exit gate (before returning to user)

After Phase 4 (or early stop), **verify Linear** before finishing:

1. `get_issue` — read `## Sapphire status` and issue state
2. `list_comments` — confirm phase headers exist

Check **every** status row marked `done` on the issue — including rows from prior sessions or bad runs, not only phases finished in the current run. Each `done` row must have its matching comment(s) on Linear.

| Status row on Linear | Must be true on Linear |
|----------------------|-------------------------|
| Investigator → `done` | Comment `**Sapphire · Investigator complete**` |
| Tech Lead → `done` | Comment `**Sapphire · Tech Lead complete**` |
| Coder → `done` | Comments `**PR handoff**` + `**Sapphire · Coder complete**`; optional `**Bugbot · medium (human review)**` when mediums exist |
| Reviewer → `done` | Comment `**Sapphire · Reviewer complete**` + issue state **In Review** |

**Failed exit gate examples:**

- Any `done` row missing its comment header(s)
- Any row still `pending` when the run claimed to finish through that phase
- All four rows `done` but issue state is still **In Progress** (missing Reviewer state-only `save_issue`)
- Issue state **In Review** while any row is still `pending`

### Repair (retroactive)

If work is done but gates were skipped:

1. Reconstruct summaries from session artifacts (investigation, spec, PR URL)
2. Post missing comments in phase order (Investigator → Tech Lead → PR handoff → Coder → Reviewer)
3. `save_issue` with full merged description — set each completed row → `done`
4. If Reviewer pass criteria are met and issue is not **In Review**, `save_issue` with `state: "In Review"` only (no `description`)
5. Re-run exit gate (comments, all `done` rows, and issue state); only then return to user

Do **not** tell the user the run succeeded when exit gate fails — repair first or report which gates are missing.

## Orchestrator checklist (copy per phase)

After each phase, mentally confirm before continuing:

```
[ ] save_comment posted with exact phase header
[ ] save_issue updated status row to done (full description merge)
[ ] get_issue confirms row shows done (optional but recommended on Cloud)
[ ] Next phase may start
```

Coder additionally:

```
[ ] Local verification exit 0 (allowlisted pnpm)
[ ] PR open on GitHub (validated via gh)
[ ] CI green — required checks pass on PR
[ ] Bugbot run — 0 High
[ ] **Bugbot · medium (human review)** comment posted when ≥1 Medium
[ ] **PR handoff** comment posted before Coder complete
[ ] Coder complete lists verification + CI + Bugbot summary (points to medium comment or `none`)
```

Reviewer additionally:

```
[ ] Coder complete documents verification + CI green + Bugbot 0 High
[ ] /goal criteria pass
[ ] Reviewer row done saved before state change
[ ] save_issue state In Review (description omitted)
```
