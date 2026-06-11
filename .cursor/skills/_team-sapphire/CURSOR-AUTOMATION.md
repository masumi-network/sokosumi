# Cursor Automation (Team Sapphire)

Optional Linear-triggered Cloud Agents. **Disable legacy `feature-spec` automations** before using Team Sapphire — they conflict with the single-issue model.

## Why this matters

`_task` delegates **Cursor on the requirement issue** at handoff. Later, Tech Lead adds `[repo=masumi-network/sokosumi]` to the **same issue** when writing `## Spec`.

Legacy automations from the removed `feature-spec` skill can start a **second** coding agent when:

- Description is updated to include `[repo=…]`, or
- Delegate is already `Cursor` and an "implementation issue" automation fires.

That races Team Sapphire's Coder phase (Phase 3).

## Disable these legacy automations

Turn off any Cursor Automation that matches the old pipeline:

| Legacy automation | Old trigger | Why disable |
|-------------------|-------------|-------------|
| SOK Write PRD → feature-spec | Issue created; title `chore(spec): write implementation PRD` | No Write PRD sub-task in Sapphire model |
| SOK implementation → Cloud Agent | Delegate `Cursor` + description contains `[repo=…]`; title not `chore(spec):` / `chore(review):` | Same issue gets `[repo=…]` during Tech Lead — fires duplicate coder |
| Reviewer on parent **In Review** (old verify sub-task flow) | Status → In Review | Reviewer runs inside Sapphire orchestrator on same issue |

If unsure, search Cursor Automations for filters on `[repo=masumi-network/sokosumi]` or `chore(spec): write implementation PRD` and disable them.

## Recommended setup (optional)

Prefer MCP handoff in `_task/HANDOFF.md` (delegate on create). Use **at most one** optional automation:

| Field | Value |
|-------|--------|
| Name | SOK Team Sapphire → orchestrator |
| Trigger | Linear — Delegate assigned → `Cursor` |
| Filter | Team SOK; description contains `## Sapphire status` |
| Tools | Linear, GitHub |
| Instructions | Read repo `.cursor/skills/_team-sapphire/SKILL.md`. Run full squad on this issue: Investigator → Tech Lead → Coder → Reviewer. Single issue only — no child issues. Do not re-delegate or `@Cursor` on the same issue. |

Do **not** also set MCP `delegate` **and** this automation on the same issue — pick one trigger.

Filter on `## Sapphire status`, **not** `[repo=…]` alone — the repo hint appears later on the same ticket.

## Manual path

No automation: `_task` handoff uses MCP `delegate` or one `@Cursor` comment per `../_task/HANDOFF.md`.

## Auth notes

- Cursor admin: connect Linear in [Cursor integrations](https://cursor.com/docs/integrations/linear).
- Cloud Agent: enable Linear MCP on the agent run (first delegated run may need once per agent).
