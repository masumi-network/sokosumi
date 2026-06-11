# Handoff to Team Sapphire

Run after the requirement issue is created in Linear. Default unless user set `handoffToSapphire: false` (legacy alias: `handoffToPrd: false`).

## Goal

Start **Team Sapphire** on the **same issue** — one ticket from requirement through PR and review.

The _task agent does **not** run Investigator, Tech Lead, Coder, or Reviewer.

## One trigger rule

Start Cloud Agent **once** on the main issue.

| Path | Trigger | Do not also |
|------|---------|-------------|
| **Default (MCP)** | `save_issue` with `id` + `delegate: "Cursor"` on the requirement issue | `@Cursor` comment on the same issue |
| **Manual fallback** | One `@Cursor` comment on the issue only | `delegate` on the same issue |

Duplicate triggers (delegate + `@Cursor`) can start two Sapphire runs on one issue.

## Steps

### 1. Add Sapphire footer to description

Use `save_issue` with `id` = requirement issue. Append to description (keep Requirement body):

```markdown
## Sapphire status
| Phase | Status |
| Investigator | pending |
| Tech Lead | pending |
| Coder | pending |
| Reviewer | pending |

---
_Sapphire squad — run `.cursor/skills/_team-sapphire/SKILL.md` on this issue._
```

If `## Requirement` heading is missing, wrap the approved body under `## Requirement` when posting.

### 2. Delegate to Cursor (default)

After footer is saved:

```json
{
  "server": "user-linear",
  "toolName": "save_issue",
  "arguments": {
    "id": "SOK-XXX",
    "delegate": "Cursor"
  }
}
```

Ensure Linear MCP is enabled on the Cloud Agent run (first delegated run may need one-time enable in agent MCP/tools).

### 3. Informational comment (optional)

```markdown
Requirement filed. Team Sapphire handoff — orchestrator runs Investigator → Tech Lead → Coder → Reviewer on this issue.
```

Do **not** include `@Cursor` when `delegate` is set.

### 4. Manual fallback only (no `delegate`)

```markdown
@Cursor Run _team-sapphire skill for SOK-XXX. Single issue — Investigator, Tech Lead, Coder, Reviewer per `.cursor/skills/_team-sapphire/SKILL.md`. Do not create child issues.
```

## In-session handoff

When the user approved in this chat:

```text
Requirement posted: SOK-XXX (delegated to Cursor / Team Sapphire).

To continue in this chat instead of Cloud Agent, say: run _team-sapphire for SOK-XXX
```

## Opt-out

When `handoffToSapphire` is false:

- Post requirement only.
- Return issue URL.
- Tell user: `Run _team-sapphire for SOK-XXX when ready.`

## Post-handoff response

Return:

- Issue id and URL
- Label, project, assignee, priority, state
- Delegate: Cursor yes/no
- Trigger path: MCP delegate / manual `@Cursor`
