# Team Sapphire

Single-issue squad: Investigator → Tech Lead → Coder(s) → Reviewer.

## Load order

1. `SKILL.md` — orchestrator (required).
2. `GATES.md` + `LINEAR.md` — before Linear writes.
3. `ROLES.md` — current phase.
4. `BUGBOT-LEARNINGS.md` — Investigator flags; Coder/Bugbot gates.
5. `SPEC-TEMPLATE.md` + `SUBAGENT-RUBRIC.md` — Tech Lead.
6. `VISUAL-CAPTURE.md` — Reviewer UI evidence.
7. `CURSOR-AUTOMATION.md` — optional Cloud trigger.

## Subagents

| Role | When | Agent file | Model |
|------|------|------------|-------|
| Coder | **Always** for implementation | `.cursor/agents/sapphire-coder.md` | Pin `composer-2.5` |
| Tech Lead | Optional (default: orchestrator) | `.cursor/agents/sapphire-tech-lead.md` | Inherit parent (no `model` in frontmatter) |
| Reviewer | Optional UI-heavy `/goal` (default: orchestrator) | `.cursor/agents/sapphire-reviewer.md` | Inherit parent (no `model` in frontmatter) |

Investigator always runs on the orchestrator. Do not hardcode Tech Lead/Reviewer model slugs in the skill.

## Output rule

Specs stay concise; always include data flow. Artifacts (`Investigation`, `Spec`) are Linear **comments**. Orchestrator owns gates. Run all phases through **In Review** in one session.
