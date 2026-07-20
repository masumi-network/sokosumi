# Linear MCP — Team Sapphire

Single-issue updates only. No child issues. Gates: `GATES.md`.

## What goes where

| On Linear | Not on issue description |
|-----------|--------------------------|
| `## Requirement` (do not rewrite without human approval) | Full investigation / spec as description sections |
| `## Sapphire status` | |
| Phase **comments** (artifacts + Coder/Reviewer complete) | |
| Issue state (`In Progress` → `In Review`) | Agents never set **Done** |

## Hard rules

- Inspect Linear tool schemas before writes (`GetMcpTools` / server tools).
- Never call a write without a complete `arguments` object.
- If Linear MCP is missing, stop:

  ```text
  Linear MCP is not loaded in this agent. In Cursor: Settings → MCP → enable Linear, then reload. For Cloud Agents, enable Linear on the agent run.
  ```

## Status-only merge

Every `save_issue` that sets `description`:

1. `get_issue` first.
2. Start from full existing `description`.
3. Keep only `## Requirement`, `## Sapphire status`, and optional Sapphire footer (one-line italic under a `---` after the status table, e.g. `_Sapphire squad — do not edit status by hand_`). If no footer exists, do not invent one.
4. **Remove** `## Investigation`, `## Spec`, and other phase body sections.
5. Update the status row; pass the **entire** trimmed markdown.

Linear replaces the whole field — never send only a status block.

Prefer state-only `save_issue` (`id` + `state`, no `description`) for **In Review** after the status table is saved.

### Initial status block

```markdown
## Sapphire status
| Phase | Status |
|-------|--------|
| Investigator | pending |
| Tech Lead | pending |
| Coder | pending |
| Reviewer | pending |
```

### State

| When | State |
|------|-------|
| Sapphire starts (was Triage) | `In Progress` |
| Reviewer pass | `In Review` |
| After human merge | Human sets `Done` |

## Artifact comments

Post full investigation/spec as comments (see `SKILL.md`). Prefer updating an existing artifact comment via `save_comment` with `id` when re-running a phase; otherwise post a new one and treat the newest as canonical for resume.

## Comment headers

| Purpose | Header |
|---------|--------|
| Investigation artifact | `**Sapphire · Investigation**` |
| Spec artifact | `**Sapphire · Spec**` |
| Coder gate | `**Sapphire · Coder complete**` |
| Bugbot medium | `**Bugbot · medium (human review)**` |
| Reviewer pass | `**Sapphire · Reviewer complete**` |
| Reviewer fail (loop) | `**Sapphire · Review failed**` |
