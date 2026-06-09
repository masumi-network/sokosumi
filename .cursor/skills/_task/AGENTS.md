# _task Skill

Source of truth for drafting Sokosumi **requirement** issues before the spec agent runs.

## Load order

1. Read `SKILL.md`.
2. Read `WORKFLOW.md` for _task vs spec agent roles and the approval gate.
3. Use `../feature-spec/REQUIREMENT-TEMPLATE.md` for the draft body.
4. Read `LINEAR-MCP.md` only **after** user approval.
5. Read `HANDOFF.md` after the requirement issue is created.
6. Downstream PRD work: `../feature-spec/SKILL.md` (do not substitute this skill for feature-spec).

## Runtime notes

- Cursor loads this as a project skill.
- Claude Code and Codex: treat `SKILL.md` as task instructions.
- If Linear MCP is unavailable after approval, return the approved draft and say what to reload. No browser or API fallback.

## Output rule

- Draft in chat first. **Wait for approval.**
- Keep requirements concise. No data-flow diagram, no file lists, no verification checklist.
- After approval: one requirement issue + PRD handoff per `HANDOFF.md`.
