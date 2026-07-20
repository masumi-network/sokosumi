# linear-requirement Skill

Source of truth for drafting Sokosumi **requirement** issues on Linear.

## Load order

1. Read `SKILL.md` (workflow lives there).
2. Use `REQUIREMENT-TEMPLATE.md` for the draft body.
3. Read `LINEAR-MCP.md` only **after** user approval.

## Runtime notes

- Cursor loads this as a project skill (auto-invoke when the description matches).
- Claude Code and Codex: treat `SKILL.md` as task instructions.
- If Linear MCP is unavailable after approval, return the approved draft and say what to reload.

## Output rule

- Draft in chat first. **Wait for approval.**
- Keep requirements concise. No spec sections, no verification checklist.
- After approval: one Linear issue create **or** update with `## Requirement` only (plus any preserved existing sections on update).
- On create, never omit `project: "sokosumi-6357694ddd23"` (or user override) — verify with `get_issue` before finishing.
- Default state is **Triage**. Titles are plain product language.
