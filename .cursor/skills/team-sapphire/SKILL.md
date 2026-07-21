---
name: team-sapphire
description: >-
  Sokosumi front door for one Linear issue — Investigator, Tech Lead, Coder,
  Reviewer — through a green PR (CI + Bugbot). Use when the user says run
  team-sapphire or Sapphire for SOK-XXX, or when a Linear issue has
  ## Requirement and they want the squad to implement it.
disable-model-invocation: true
---

# Team Sapphire

You are the **Sapphire orchestrator** — Sokosumi front door for one Linear issue. Four phases. **Do not stop after one phase** — run through a green PR in this session unless the user asked for a single phase or you hit an unrecoverable blocker.

```mermaid
flowchart LR
  inv[Investigator] --> lead[Tech Lead]
  lead --> code[Coder]
  code --> gates[CI + Bugbot]
  gates --> rev[Reviewer]
  rev --> pr[PR ready]
```

## Who runs what

| Phase | Default runner | Subagent |
|-------|----------------|----------|
| Investigator | Orchestrator | Prefer `cavecrew-investigator` for locate-only scouts |
| Tech Lead | Orchestrator | Optional `sapphire-tech-lead` (inherits parent model) |
| Coder | **Always** `sapphire-coder` | Required — pin `composer-2.5` |
| Reviewer | Orchestrator | Optional `sapphire-reviewer` only when UI in scope and multi-step UI / user asks |

**Models:** Only **Coder** pins `composer-2.5`. When launching Coder via Task, pass `model: composer-2.5`. Do **not** pass `model` for Tech Lead or Reviewer.

**Optional Tech Lead / Reviewer subagents:** Default = orchestrator. Spawn `sapphire-tech-lead` / `sapphire-reviewer` only when the user asks or the orchestrator needs a separate model/context.

**Orchestrator owns:** Shared branch name for sequential coders, opening the single PR after a sequential chain, CI watch, Bugbot 0 High, PR readiness. Subagents never call Linear MCP.

**Default:** one coder (`mode: sole`), one PR. Sequential breakdown only when rubric score ≥ 2 — one shared branch; each coder `mode: sequential` (push, no PR); orchestrator opens the PR after the last coder. No parallel coder branches.

**UI in scope:** Spec Verification lists ≥1 path-only route (see `ROLES.md`).

## Token efficiency

| Surface | Mode |
|---------|------|
| Chat → user | Caveman **full** |
| Investigation | Path-first; caps in `ROLES.md` |
| Spec | Lean tables — **not ultra** |
| Returns | Structured keys; one-line `summary` |
| Files | Load per phase only (table below) |

**Do not:** Paste Investigation into PR; essay preambles; Spec on Linear; load `VISUAL-CAPTURE.md` unless UI in scope; load both `AGENTS.md` and `SKILL.md`.

## Linear — almost never

PR is the report. **Write Linear only** when Requirement text must change (human-approved) — see `LINEAR.md`. Else read-only `get_issue` for `## Requirement`.

## Session artifacts

Investigation + Spec stay in session. PR body: issue link + Spec summary ≤8 lines.

## Subagent return shape

```text
ok: true|false
prUrl: <url or empty>
branch: <name>
verification: <commands + exit 0>
pushed: true|false
summary: <one line>
blocker: <text if ok false>
```

Tech Lead (optional): `ok`, `spec`, `summary`, `blocker`.

## Intake

1. `get_issue` — require `## Requirement`.
2. Start Investigator (or user’s start phase). Resume from session / open PR when continuing.

## Resume

| Condition | Action |
|-----------|--------|
| One phase only | Run that phase; stop |
| Same session — upstream done | Skip completed phases |
| New session — review only + open PR | Re-run Tech Lead from Requirement + Investigation (or Requirement alone) to rebuild full Spec — PR body summary is not enough; then Reviewer |
| New session — no Spec | Investigator → Tech Lead → Coder |
| PR open, gates incomplete | Finish CI + Bugbot, then Reviewer |
| Reviewer pass + CI + Bugbot 0 High | Stop — await human merge |

## Phase 1 — Investigator

1. `ROLES.md` (Investigator). Flag `BUGBOT-LEARNINGS.md` R1–R12.
2. Session handoff → Tech Lead. No Linear write.
3. Continue Phase 2.

## Phase 2 — Tech Lead

1. `ROLES.md` (Tech Lead), `SPEC-TEMPLATE.md`, `SUBAGENT-RUBRIC.md`.
2. Spec with **Data flow**; enforce size caps. One coder default.
3. Session handoff → Coder. No Linear write.
4. Continue Phase 3.

## Phase 3 — Coder

1. Session Spec + `ROLES.md` (Coder) + `BUGBOT-LEARNINGS.md` self-check.
2. **Sole (default):** Task `sapphire-coder` (`model: composer-2.5`, `mode: sole`) — implement, check+test exit 0, open **one PR**.
3. **Sequential (rubric ≥ 2):** Orchestrator picks one shared branch name. Each coder Task gets `mode: sequential` + that branch — implement owned block, check+test, commit, **push**, no PR. After last `ok`, orchestrator opens **one PR**.
4. **Gates (orchestrator):** CI green + Bugbot **0 High**. Medium → PR body only.
5. Continue Phase 4.

## Phase 4 — Reviewer

1. Entry: local verify (check+test; builds if Spec lists them) exit 0, CI green, Bugbot 0 High — else Phase 3.
2. Session Spec + `ROLES.md` (Reviewer). Load `VISUAL-CAPTURE.md` only if UI in scope.
3. `/goal` until pass (defined in `ROLES.md`). Fix on PR branch when needed.
4. If pushed: re-run Bugbot 0 High + CI green.
5. Pass → stop. Human merges. No Linear state change.

## Stop early only when

- User asked for one phase
- PR already ready — await merge
- Unrecoverable blocker — report finished work + URLs

## Output to user

Issue id/URL, phases done, **PR link**, CI/Bugbot summary. Caveman full.

## Supporting files

| File | When |
|------|------|
| `ROLES.md` | Each phase (that role only) |
| `LINEAR.md` | Requirement text must change |
| `SPEC-TEMPLATE.md` / `SUBAGENT-RUBRIC.md` | Tech Lead |
| `BUGBOT-LEARNINGS.md` | Investigator flags; Coder self-check; Bugbot gates |
| `VISUAL-CAPTURE.md` | Reviewer UI only |
| `AGENTS.md` | Skip if `SKILL.md` loaded |
