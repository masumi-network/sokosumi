# Feature Spec Skill

Use this directory as the source of truth for Sokosumi feature specs in Codex, Claude Code, and Cursor.

## Load order

1. Read `SKILL.md`.
2. Read `WORKFLOW.md` for requirement vs implementation issues and the coding-agent handoff.
3. Upstream requirement drafting: `../_task/SKILL.md` (approval gate before Linear).
4. Use `REQUIREMENT-TEMPLATE.md` when reviewing or writing high-level requirement issues.
5. Use `TEMPLATE.md` for the implementation PRD shape.
6. Use `SUBAGENT-RUBRIC.md` to decide whether to include current/target architecture and subagent workstreams.
7. Use `LINEAR-MCP.md` when publishing the implementation issue and sub-tasks (no approval gate).
8. Use `PRD-REVIEWER.md` for the post-implementation reviewer `/goal` loop.
9. Use `CURSOR-AUTOMATION.md` when setting up optional Linear-triggered Cloud Agents.

## Runtime notes

- Cursor can load this as a project skill.
- Claude Code should treat `SKILL.md` as the skill body.
- Codex should treat this `AGENTS.md` plus `SKILL.md` as task instructions.
- If a runtime cannot access Linear MCP, return the draft PRD in chat and tell the user what is missing. Do not use browser automation or raw Linear API fallback.

## Output rule

Always keep specs concise and include a data flow diagram.

Implementation PRDs are for Cursor Cloud Agent. Requirement issues are not.
