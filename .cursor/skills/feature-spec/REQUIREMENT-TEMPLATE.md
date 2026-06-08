# Requirement Issue Template

Use this for **human-written** Linear issues. This is spec-agent **input**, not coding-agent input.

Keep it short. Architectural ideas are welcome; file-level plans are not required here.

```markdown
**Problem:** User pain or product gap in one or two sentences.

**Goal:** Desired outcome. What "done" looks like for the user.

**Confirmed decisions:**
- Decision already locked (scope, non-goals, product calls).
- Another locked decision if needed.

**Architecture ideas (optional, not final):**
- Rough data flow or layer changes (API, DB, UI).
- Open questions the spec agent should resolve in code discovery.

**References:**
- Related Linear issues, mocks, PRs, or docs.

**Out of scope:**
- Explicit non-goals for v1.
```

## Good requirement example

[SOK-537](https://linear.app/masumi/issue/SOK-537/create-history-view): problem, unified history concept, core API idea, UI fields, mock — no file list, no verification checklist.

## Bad requirement example (too detailed for this stage)

A full PRD with `Contract / behavior` tables, `Files to add/change`, and `pnpm --filter web check` — that belongs on the **implementation** issue after the spec agent runs.

## Handoff marker

When a requirement is ready for the spec agent, either:

- Comment `@spec` or ask in Cursor with the issue id, **or**
- Move to a triage state/label your team uses for "needs PRD" (optional team convention).

The spec agent produces the implementation issue from `TEMPLATE.md`.
