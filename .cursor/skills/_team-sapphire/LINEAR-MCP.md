# Linear MCP — Team Sapphire

Single-issue updates only. No child issues.

## Hard rules

- MCP only. Inspect `user-linear/tools/*.json` before writes.
- Never call a write tool without a complete `arguments` object.
- Stop if Linear MCP is not loaded — same reload message as `../_task/LINEAR-MCP.md`.
- Optional smoke test: `get_user` with `{ "query": "me" }`.

## Issue description updates

Use `save_issue` with `id` = issue identifier. Merge sections — do not wipe Requirement.

### Initial Sapphire block (orchestrator start)

If `## Sapphire status` is missing, prepend after Requirement:

```markdown
## Sapphire status
| Phase | Status |
|-------|--------|
| Investigator | pending |
| Tech Lead | pending |
| Coder | pending |
| Reviewer | pending |
```

### After each phase

Update the status table row to `done` and append the phase section (`## Investigation` or `## Spec`).

### State transitions

| Action | `save_issue` |
|--------|----------------|
| Phases 1–3 running | `state: "In Progress"` (default from _task) |
| Reviewer pass | `state: "In Review"` |
| Human merge | Human sets `Done` — agents do not |

## Comments

Use structured headers for audit trail:

| Phase | Comment header |
|-------|----------------|
| Investigator | `**Sapphire · Investigator complete**` |
| Tech Lead | `**Sapphire · Tech Lead complete**` |
| Coder | `**Sapphire · Coder complete**` + `**PR handoff**` |
| Reviewer pass | `**Sapphire · Reviewer complete**` |
| Reviewer fail | `**Sapphire · Review failed**` |

## Write examples

Update description after Investigation:

```json
{
  "server": "user-linear",
  "toolName": "save_issue",
  "arguments": {
    "id": "SOK-549",
    "description": "<full merged markdown with Requirement, status, Investigation>"
  }
}
```

Reviewer sets In Review:

```json
{
  "server": "user-linear",
  "toolName": "save_issue",
  "arguments": {
    "id": "SOK-549",
    "state": "In Review"
  }
}
```

## Idempotency

Before appending a section, read `get_issue`. Skip phase if section already exists unless user asked to re-run.

## Post-run response

Return issue id/URL, phases completed, Linear state, PR URL if any.
