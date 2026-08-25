# linear-requirement Skill

Source of truth for drafting Sokosumi **requirement** issues on Linear.

## Load order

1. Read `SKILL.md` (workflow lives there).
2. Use `REQUIREMENT-TEMPLATE.md` for the draft body.
3. Read `LINEAR-CLI.md` only **after** user approval.

## Runtime notes

- `disable-model-invocation: true` — load only when the user names this skill or explicitly asks to draft/file a Linear requirement. Never auto-start from implement context.
- Canonical files: `skills/linear-requirement/`. Install into agent skill dirs with `npx skills add . --skill linear-requirement`.
- If `linear` is missing or unauthenticated after approval, return the approved draft and say the CLI is not available. Do not fall back to Linear MCP.

## Output rule

- Draft in chat first. **Wait for approval.**
- Keep requirements concise. No spec sections, no verification checklist.
- After approval: one Linear issue **create** or **update** with `## Requirement` (plus any preserved existing sections on update).
- On create, never omit `--project sokosumi-6357694ddd23` (or user override) — verify with `linear issue view <id> --json` before finishing.
- Default state is **Triage** on create only. Updates never reset state to Triage.
- Titles are plain product language.
