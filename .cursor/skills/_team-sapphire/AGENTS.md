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

Models live **only** in agent frontmatter. Do not duplicate model slugs elsewhere.

| Role | When | Agent file |
|------|------|------------|
| Coder | **Always** for implementation | `.cursor/agents/sapphire-coder.md` |
| Tech Lead | Optional (default: orchestrator) | `.cursor/agents/sapphire-tech-lead.md` |
| Reviewer | Optional UI-heavy `/goal` (default: orchestrator) | `.cursor/agents/sapphire-reviewer.md` |

Investigator always runs on the orchestrator.

## Output rule

Specs stay concise; always include data flow. Artifacts (`Investigation`, `Spec`) are Linear **comments**. Orchestrator owns gates. Run all phases through **In Review** in one session.
