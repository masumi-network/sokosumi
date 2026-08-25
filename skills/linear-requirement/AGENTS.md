# linear-requirement Skill

Source of truth for drafting Sokosumi **requirement** issues on Linear.

## Load order

1. Read `SKILL.md` (workflow lives there).
2. Use `REQUIREMENT-TEMPLATE.md` for the draft body.
3. Read `LINEAR-MCP.md` only **after** user approval.

## Runtime notes

- `disable-model-invocation: true` — load only when the user names this skill or explicitly asks to draft/file a Linear requirement. Never auto-start from poteto-mode / implement context.
- Canonical files: `skills/linear-requirement/`. Install into agent skill dirs with `npx skills add . --skill linear-requirement`.
- If Linear MCP is unavailable after approval, return the approved draft and say what to reload.

## Output rule

- Draft in chat first. **Wait for approval.**
- Keep requirements concise. No spec sections, no verification checklist.
- After approval: one Linear issue **create** or **update** with `## Requirement` (plus any preserved existing sections on update).
- On create, never omit `project: "sokosumi-6357694ddd23"` (or user override) — verify with `get_issue` before finishing.
- Default state is **Triage** on create only. Updates never reset state to Triage.
- Titles are plain product language.
