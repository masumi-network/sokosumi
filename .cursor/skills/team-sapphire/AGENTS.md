# Team Sapphire

Single-issue squad: Investigator → Tech Lead → Coder(s) → Reviewer → PR.

## Load order

1. `SKILL.md` — orchestrator (required).
2. `ROLES.md` — current phase.
3. `BUGBOT-LEARNINGS.md` — Investigator flags; Bugbot gates.
4. `SPEC-TEMPLATE.md` + `SUBAGENT-RUBRIC.md` — Tech Lead.
5. `VISUAL-CAPTURE.md` — Reviewer UI evidence.
6. `LINEAR.md` — **only** if Requirement text must change.
7. `CURSOR-AUTOMATION.md` — optional Cloud trigger.

## Subagents

| Role | When | Agent file | Model |
|------|------|------------|-------|
| Coder | **Always** for implementation | `.cursor/agents/sapphire-coder.md` | Pin `composer-2.5` |
| Tech Lead | Optional (default: orchestrator) | `.cursor/agents/sapphire-tech-lead.md` | Inherit parent |
| Reviewer | Optional UI-heavy `/goal` (default: orchestrator) | `.cursor/agents/sapphire-reviewer.md` | Inherit parent |

## Output rule

Specs stay concise; always include data flow. Investigation/Spec stay in **session** (PR body gets a short summary). **No Linear phase reporting.** Run through CI + Bugbot green and Reviewer pass in one session; human merges the PR.
