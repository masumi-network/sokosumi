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

When a requirement is ready for the spec agent:

- **Default:** `_task` skill posts to Linear after approval and hands off via `../_task/HANDOFF.md` (Write PRD sub-task with `delegate: "Cursor"` only — no `@Cursor` on requirement or sub-task; automation or manual `@Cursor` are mutually exclusive fallbacks).
- **Manual:** Run `feature-spec` in Cursor with the requirement issue id.
- Optional: triage on title `chore(spec): write implementation PRD` — see `CURSOR-AUTOMATION.md`.

Requirement descriptions must **not** include `[repo=…]`, `## Data flow`, or `## Verification` — those mark **implementation** issues only.

The spec agent produces the implementation issue from `TEMPLATE.md`.
