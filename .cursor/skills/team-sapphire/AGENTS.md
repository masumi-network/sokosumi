# Team Sapphire

Sokosumi front door: Investigator → Tech Lead → Coder → Reviewer → PR (CI + Bugbot).

> Prefer `SKILL.md`. Skip this file when `SKILL.md` already loaded.

## Load order

1. `SKILL.md` — orchestrator
2. `ROLES.md` — current phase
3. `BUGBOT-LEARNINGS.md` — flags / self-check / Bugbot gates
4. `SPEC-TEMPLATE.md` + `SUBAGENT-RUBRIC.md` — Tech Lead
5. `VISUAL-CAPTURE.md` — Reviewer UI only
6. `LINEAR.md` — Requirement text must change

## Subagents

| Role | When | Agent | Model |
|------|------|-------|-------|
| Coder | Always | `sapphire-coder` | `composer-2.5` |
| Tech Lead | Optional | `sapphire-tech-lead` | Inherit |
| Reviewer | Optional UI `/goal` | `sapphire-reviewer` | Inherit |
| Locate scout | Locate-only | `cavecrew-investigator` | Inherit |

## Rules

- Investigation: path-first; Spec: lean caps — not ultra prose
- One coder / one PR default; sequential breakdown only if rubric ≥ 2
- No Linear phase reporting; human merges
