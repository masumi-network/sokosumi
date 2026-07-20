# Sapphire Pipeline

Separate from requirement filing. One Linear issue. Start when the user asks (or an optional automation fires).

```mermaid
flowchart LR
  issue["Linear issue\n## Requirement"] --> sapphire["_team-sapphire"]
  sapphire --> inv["Investigator\n(session)"]
  inv --> lead["Tech Lead\n(session spec)"]
  lead --> code["Coder(s)"]
  code --> pr["Pull request"]
  pr --> gates["CI green +\nBugbot 0 High"]
  gates --> rev["Reviewer\n/goal loop"]
  rev -->|pass| review["In Review"]
  review --> human["Human merge → Done"]
```

Requirement drafting lives in `../linear-requirement/` — that skill does **not** start Sapphire.

## Single session rule

The orchestrator runs **Investigator → Tech Lead → Coder → Reviewer** in one agent session. Phase completion comments are audit markers — not handoff to a new run.

Resume: use **artifact-aware resume** in `SKILL.md` — status `done` does not skip a phase when session investigation or spec is missing. Rebuild Investigator → Tech Lead before Coder or Reviewer in a new session; then finish every later phase in the same session.

## Roles

| Role | Output | Where it lives |
|------|--------|----------------|
| **Investigator** | Pitfalls, patterns, recommendations | **Session** → Tech Lead |
| **Tech Lead** | Implementable spec, optional coder breakdown | **Session** → Coder, Reviewer |
| **Coder** | Code + PR + verification + CI + Bugbot + `**PR handoff**` | GitHub + Linear comments |
| **Reviewer** | Evidence + issue **In Review** | Linear state + comments |

## Issue description shape (Linear)

Only requirement and progress on the issue:

```markdown
## Requirement
(from linear-requirement or human — do not rewrite without human approval)

## Sapphire status
| Phase | Status |
|-------|--------|
| Investigator | pending / done |
| Tech Lead | pending / done |
| Coder | pending / done |
| Reviewer | pending / done |
```

Investigation and spec stay in the orchestrator session — not in this document.

Phase transitions post structured **summary** comments (`**Sapphire · … complete**`) for audit trail. These are **blocking gates** — see `PHASE-GATE.md`. Do not defer them to the end of the run.

## Status lifecycle

| State | Set by | When |
|-------|--------|------|
| `In Progress` | Issue author (`linear-requirement` or human) | Issue created; through Investigator, Tech Lead, Coder |
| `In Review` | Reviewer | All `/goal` criteria pass |
| `Done` | Human | After PR merge |

## How to start

Manual (default): `Run _team-sapphire for SOK-XXX` in Cursor.

Optional Cloud trigger: see `CURSOR-AUTOMATION.md` — not tied to `linear-requirement`.

## What not to do

- Do not create child Linear issues for spec, code, or review.
- Do not write `## Investigation` or `## Spec` to the Linear description.
- Do not run Coder before **session spec** exists.
- Do not set **In Review** when the PR opens — Reviewer sets it on pass.
- Do not start Reviewer until **local verification exit 0**, **CI green**, and **Bugbot 0 High** (`CODER.md`, `BUGBOT-LEARNINGS.md`).
- Do not mark **Done** before human merge.
- Do not batch phase comments or status updates at the end — each phase gate must pass before the next phase (`PHASE-GATE.md`).
