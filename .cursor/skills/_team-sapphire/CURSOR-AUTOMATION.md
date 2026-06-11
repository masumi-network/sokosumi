# Cursor Automation (optional)

Optional Linear-triggered Cloud Agents for Team Sapphire. Default path is MCP handoff in `../_task/HANDOFF.md`.

## One issue, one trigger

`_task` delegates **Cursor on the issue** at handoff. Tech Lead later adds `[repo=masumi-network/sokosumi]` to the **same issue** when writing `## Spec`.

Do **not** add Cursor Automations that trigger on description contains `[repo=…]` alone — that can start a second agent when the spec is written and race Sapphire's Coder phase.

Use **at most one** trigger per issue: MCP `delegate`, optional automation below, or manual `@Cursor` — not combined.

## Optional automation

Prefer MCP `delegate` from `_task/HANDOFF.md`. If the team uses automation instead, omit MCP `delegate` on the same issue.

| Field | Value |
|-------|--------|
| Name | SOK Team Sapphire → orchestrator |
| Trigger | Linear — Delegate assigned → `Cursor` |
| Filter | Team SOK; description contains `## Sapphire status` |
| Tools | Linear, GitHub, **Browser** (see `VISUAL-CAPTURE.md`) |
| Instructions | Read repo `.cursor/skills/_team-sapphire/SKILL.md`. Run full squad on this issue: Investigator → Tech Lead → Coder → Reviewer. Single issue only — no child issues. Reviewer: capture UI evidence per `VISUAL-CAPTURE.md`. Do not re-delegate or `@Cursor` on the same issue. |

Filter on `## Sapphire status`, **not** `[repo=…]` alone — the repo hint is added later on the same ticket.

## Manual path

No automation: `_task` handoff uses MCP `delegate` or one `@Cursor` comment per `../_task/HANDOFF.md`.

## Auth notes

- Cursor admin: connect Linear in [Cursor integrations](https://cursor.com/docs/integrations/linear).
- Cloud Agent: enable Linear MCP on the agent run (first delegated run may need once per agent).
- Reviewer visuals: enable **shell** + install `agent-browser` (`VISUAL-CAPTURE.md`), or **cursor-ide-browser** MCP for screenshots in Cursor.
