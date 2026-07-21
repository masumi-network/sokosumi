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
| Tech Lead | Only if user asks | `sapphire-tech-lead` | Inherit |
| Reviewer | Only if user asks | `sapphire-reviewer` | Inherit |
| Locate scout | Symbol locate only (defs/callers/uses) | `cavecrew-investigator` | Inherit |

## Rules

- Investigation: path-first; Spec: lean caps — not ultra prose
- Branch: Linear `gitBranchName` or `sok-NNN-short-kebab` (≤6 segments)
- One coder / one **draft** PR default; title = primary commit subject; sequential = serial Tasks
- Verify set: deliverable package roots ∪ packages edited; check+test; build if listed
- UI in scope: Spec Verification has ≥1 path-only route (page/layout/component/messages deliverables)
- CI green: all `gh pr checks` pass unless named in Spec Out of scope
- No Linear phase reporting; human merges
