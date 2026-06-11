# Requirement Issue Template

Use for **human-written** or `_task`-drafted Linear issues. High-level input for Team Sapphire — not the final spec.

Keep it short. Architectural ideas welcome; file-level plans are not required here.

```markdown
## Requirement

**Problem:** User pain or product gap in one or two sentences.

**Goal:** Desired outcome. What "done" looks like for the user.

**Confirmed decisions:**
- Decision already locked (scope, non-goals, product calls).

**Architecture ideas (optional, not final):**
- Rough data flow or layer changes (API, DB, UI).
- Open questions for Investigator / Tech Lead.

**References:**
- Related Linear issues, mocks, PRs, or docs.

**Out of scope:**
- Explicit non-goals for v1.
```

## Good example

[SOK-537](https://linear.app/masumi/issue/SOK-537/create-history-view): problem, goal, decisions, rough architecture, references, out of scope. No file list, no verification checklist.

## Bad example (too detailed for this stage)

Contract tables, file change lists, and `pnpm web:check` — Tech Lead adds those under `## Spec` after Sapphire runs.

## Handoff

After `_task` approval, default handoff delegates **Cursor on the same issue** — see `HANDOFF.md`. Team Sapphire adds Investigation, Spec, and tracks progress on this issue.

Manual: `Run _team-sapphire for SOK-XXX`.

Requirement section must **not** include `[repo=…]` or `## Spec` — Tech Lead adds those.
