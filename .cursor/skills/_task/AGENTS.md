# _task Skill

Source of truth for drafting Sokosumi **requirement** issues before Team Sapphire runs.

## Load order

1. Read `SKILL.md`.
2. Read `WORKFLOW.md` for _task vs Sapphire roles and the approval gate.
3. Use `REQUIREMENT-TEMPLATE.md` for the draft body.
4. Read `LINEAR-MCP.md` only **after** user approval.
5. Read `HANDOFF.md` after the issue is created.
6. Downstream squad work: `../_team-sapphire/SKILL.md`.

## Runtime notes

- Cursor loads this as a project skill.
- Claude Code and Codex: treat `SKILL.md` as task instructions.
- If Linear MCP is unavailable after approval, return the approved draft and say what to reload.

## Output rule

- Draft in chat first. **Wait for approval.**
- Keep requirements concise. No spec sections, no verification checklist.
- After approval: one Linear issue + Sapphire handoff per `HANDOFF.md`.
