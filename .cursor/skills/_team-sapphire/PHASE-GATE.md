# Phase gates (blocking)

Every Sapphire phase ends with **mandatory Linear writes**. These are not optional audit niceties — they are **hard gates**.

**Do not start the next phase until the current phase gate passes.**

## Two writes per phase

| Step | Tool | Purpose |
|------|------|---------|
| 1 | `save_comment` | Phase summary with exact header (see table below) |
| 2 | `save_issue` | Update `## Sapphire status` row → `done` (status-only merge per `LINEAR-MCP.md`) |

Coder adds a third write between the two above: `**PR handoff**` comment **before** `**Sapphire · Coder complete**`.

Reviewer adds a state write **after** status table is saved: `save_issue` with `state: "In Review"` only (no `description`).

## Gate table

| Phase | Required comment header(s) | Status row after gate |
|-------|---------------------------|------------------------|
| Investigator | `**Sapphire · Investigator complete**` | Investigator → `done` |
| Tech Lead | `**Sapphire · Tech Lead complete**` | Tech Lead → `done` |
| Coder | `**PR handoff**` then `**Sapphire · Coder complete**` | Coder → `done` |
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

| Completed in this run | Must be true on Linear |
|-----------------------|-------------------------|
| Investigator | Comment `**Sapphire · Investigator complete**` + row `done` |
| Tech Lead | Comment `**Sapphire · Tech Lead complete**` + row `done` |
| Coder | Comments `**PR handoff**` + `**Sapphire · Coder complete**` + row `done` |
| Reviewer pass | Comment `**Sapphire · Reviewer complete**` + row `done` + state **In Review** |

**All four rows must be `done` when the run finishes through Reviewer.** Issue state **In Review** with any row still `pending` is a **failed exit gate**.

### Repair (retroactive)

If work is done but gates were skipped:

1. Reconstruct summaries from session artifacts (investigation, spec, PR URL)
2. Post missing comments in phase order (Investigator → Tech Lead → PR handoff → Coder → Reviewer)
3. `save_issue` with full merged description — all completed rows → `done`
4. Re-run exit gate; only then return to user

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
[ ] PR open on GitHub (validated via gh)
[ ] **PR handoff** comment posted before Coder complete
```

Reviewer additionally:

```
[ ] /goal criteria pass
[ ] Reviewer row done saved before state change
[ ] save_issue state In Review (description omitted)
```
