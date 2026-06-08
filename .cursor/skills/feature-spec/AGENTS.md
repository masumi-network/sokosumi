# Feature Spec Skill

Use this directory as the source of truth for Sokosumi feature specs in Codex, Claude Code, and Cursor.

## Load order

1. Read `SKILL.md`.
2. Use `TEMPLATE.md` for the PRD shape.
3. Use `SUBAGENT-RUBRIC.md` to decide whether to include current/target architecture and subagent workstreams.
4. Use `LINEAR-MCP.md` only after the user approves the spec.

## Runtime notes

- Cursor can load this as a project skill.
- Claude Code should treat `SKILL.md` as the skill body.
- Codex should treat this `AGENTS.md` plus `SKILL.md` as task instructions.
- If a runtime cannot access Linear MCP, stop at the approved PRD and tell the user what is missing. Do not use browser automation or raw Linear API fallback.

## Output rule

Always keep specs concise and include a data flow diagram.
