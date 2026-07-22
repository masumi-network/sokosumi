# Team Sapphire

Sokosumi front door: Investigator → Tech Lead → Coder → Reviewer → PR (CI + full Reviewer).

> Prefer `SKILL.md`. Skip this file when `SKILL.md` already loaded.

## Load order

1. `SKILL.md` — orchestrator (always)
2. `ROLES.md` — current phase role only
3. `PHASE-CODER.md` — Phase 3 only
4. `PHASE-REVIEWER.md` — Phase 4 only
5. `QUALITY-RULES.md` — R1–R12 flags, Coder self-check, Reviewer checklist
6. `SPEC-TEMPLATE.md` + `SUBAGENT-RUBRIC.md` — Tech Lead
7. `VISUAL-CAPTURE.md` — Reviewer + UI in scope
8. `LINEAR.md` — Requirement text must change

## Subagents

| Role | When | Agent | Model |
|------|------|-------|-------|
| Coder | Always | `sapphire-coder` | `composer-2.5` |
| Tech Lead | Only if user asks | `sapphire-tech-lead` | Inherit |
| Reviewer | Only if user asks | `sapphire-reviewer` | Inherit |
| Locate scout | Symbol locate only | `cavecrew-investigator` | Inherit |

## Rules

- Phase-gate file loads (above)
- Spec/Investigation caps in `ROLES.md`
- Draft PR; title = primary commit subject
- No Linear phase reporting; human merges
