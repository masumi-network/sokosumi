# Requirement Issue Template

Use for **human-written** or `linear-requirement`-drafted Linear issues. High-level product input — not the final spec.

Keep it short. Architectural ideas welcome; file-level plans are not required here.

```markdown
## Requirement

**Problem:** User pain or product gap in one or two sentences.

**Goal:** Desired outcome. What "done" looks like for the user.

**Confirmed decisions:**
- Decision already locked (scope, non-goals, product calls).

**Architecture ideas (optional, not final):**
- Rough data flow or layer changes (API, DB, UI).
- Open questions for a later design/investigation step.

**References:**
- Related Linear issues, mocks, PRs, or docs.

**Out of scope:**
- Explicit non-goals for v1.
```

## Good example

[SOK-537](https://linear.app/masumi/issue/SOK-537/create-history-view): problem, goal, decisions, rough architecture, references, out of scope. No file list, no verification checklist.

## Bad example (too detailed for this stage)

Contract tables, file change lists, and `pnpm web:check` — those belong in a later design/spec step if someone builds the issue.

## After publish

This skill stops after the Linear issue exists. Do not start a build squad from this skill.

Requirement section must **not** include `[repo=…]` or a full spec.
