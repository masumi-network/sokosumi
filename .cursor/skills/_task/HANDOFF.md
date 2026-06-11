# Handoff to Team Sapphire

Run after the requirement issue is created in Linear. Default unless user set `handoffToSapphire: false`.

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

Skip handoff when `handoffToSapphire: false` — see **Opt-out** below.

## Steps

### 0. Idempotency check

Load the issue with `get_issue` before any handoff write.

| Condition | Action |
|-----------|--------|
| Description contains `## Sapphire status` **and** delegate is already `Cursor` | Stop handoff — return issue URL; comment optional: "Sapphire handoff already active." |
| Description contains `## Sapphire status` **and** delegate is not `Cursor` | Skip step 1; run step 2 (delegate only) |
| No `## Sapphire status` | Run steps 1–2 |

Do not append a second footer or set `delegate` twice on the same issue.

### 1. Add Sapphire footer to description

**Required:** Use the **full** description from step 0’s `get_issue` as the base. `save_issue` **replaces** the entire `description` field — never post only the footer block or you will wipe the approved requirement.

1. Start from the complete existing description returned by `get_issue`.
2. If `## Requirement` is missing, add that heading and keep the approved body under it.
3. Append the footer below (only when step 0 found no `## Sapphire status`).
4. Call `save_issue` with `id` and the **merged** `description` string.

Footer to append:

```markdown
## Sapphire status
| Phase | Status |
|-------|--------|
| Investigator | pending |
| Tech Lead | pending |
| Coder | pending |
| Reviewer | pending |

---
_Sapphire squad — run `.cursor/skills/_team-sapphire/SKILL.md` on this issue._
```

### 2. Delegate to Cursor (default)

After footer is saved (or when step 0 skipped footer because it already exists):

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

When the user approved in this chat **and** step 2 set `delegate: "Cursor"`:

```text
Requirement posted: SOK-XXX (delegated to Cursor — a Cloud Agent may already be running Team Sapphire).

To run the orchestrator in this chat instead, wait for or cancel the Cloud run first, then say: run _team-sapphire for SOK-XXX

Do not run both in parallel — duplicate orchestrators race on the same issue.
```

When handoff used manual `@Cursor` only (no delegate), omit the Cloud warning and use:

```text
Requirement posted: SOK-XXX. To continue in this chat, say: run _team-sapphire for SOK-XXX
```

## Opt-out

When `handoffToSapphire: false`:

- Post requirement only.
- Return issue URL.
- Tell user: `Run _team-sapphire for SOK-XXX when ready.`

## Post-handoff response

Return:

- Issue id and URL
- Label, project, assignee, priority, state
- Delegate: Cursor yes/no
- Trigger path: MCP delegate / manual `@Cursor`
