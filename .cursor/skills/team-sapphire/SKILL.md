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

You are the **Sapphire orchestrator** — Sokosumi front door for one Linear issue. Four phases. **Do not stop after one phase** — run through a green PR in this session unless the user asked for a single phase or you hit an **unrecoverable blocker** (see Stop early).

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
| Investigator | Orchestrator | Task `cavecrew-investigator` only for symbol locate (defs / callers / uses). Else search in-orchestrator |
| Tech Lead | Orchestrator | Spawn `sapphire-tech-lead` **only when the user asks** |
| Coder | **Always** `sapphire-coder` | Required — pin `composer-2.5` |
| Reviewer | Orchestrator | Spawn `sapphire-reviewer` **only when the user asks** |

**Models:** Only **Coder** pins `composer-2.5`. When launching Coder via Task, pass `model: composer-2.5`. Do **not** pass `model` for Tech Lead or Reviewer.

**Branch name (orchestrator sets before Coder):** Prefer Linear issue `gitBranchName` when present. Else `{issue-id-lower}-{short-kebab}` from Goal (≤6 kebab segments, e.g. `sok-555-mute-notifications`). Pass that name in every Coder prompt.

**Orchestrator owns:** Branch name, opening the single PR after a sequential chain, CI watch, Bugbot 0 High, PR readiness. Subagents never call Linear MCP.

**Default:** one coder (`mode: sole`), one PR. Sequential breakdown only when rubric score ≥ 2 — one shared branch; run coder Tasks **one at a time** in Spec **Execution order** (wait for `ok` before the next); each `mode: sequential` (push, no PR); orchestrator opens the PR after the last coder. No parallel coder branches.

**UI in scope:** Spec Verification lists ≥1 path-only route (see `ROLES.md`).

**CI green:** Run `gh pr checks`. Every listed check must be `pass` / `success`. Wait/retry while any is `pending`. Fail the gate if any is `fail` / `failure` / `cancelled` / `timed_out`. Skip a check **only** if Spec **Out of scope** names that check exactly.

**PR open (Coder sole or orchestrator after sequential):** Open as **draft** unless the user asked for ready-for-review. **Title** = primary commit subject line verbatim (Conventional Commit). Body: Linear issue link + Spec summary ≤8 lines.

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

PR is the report. **Write Linear only** when Requirement text must change **and** the user explicitly confirmed the new wording in this chat — see `LINEAR.md`. Else read-only `get_issue` for `## Requirement`.

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
| New session — review only + open PR | If Investigation missing from session, re-run Investigator first. Then Tech Lead rebuilds full Spec from Requirement + Investigation (never Spec from PR body alone). Then Reviewer |
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
2. Set **branch name** (rule above). Include it in every Coder prompt.
3. **Sole (default):** Task `sapphire-coder` (`model: composer-2.5`, `mode: sole`, branch name) — implement, check+test exit 0, open **one draft PR** (title = primary commit subject).
4. **Sequential (rubric ≥ 2):** Same shared branch. Launch coder Tasks **serially** in Spec Execution order — wait for each `ok` before the next. Each gets `mode: sequential` + branch — implement owned block, check+test, commit, **push**, no PR. After last `ok`, orchestrator opens **one draft PR**.
5. **Gates (orchestrator):** **CI green** (definition above) + Bugbot **0 High**. Medium → PR body only.
6. Continue Phase 4.

## Phase 4 — Reviewer

1. Entry: local verify (check+test for verify set; builds if Spec lists them) exit 0, **CI green**, Bugbot 0 High — else Phase 3.
2. Session Spec + `ROLES.md` (Reviewer). Load `VISUAL-CAPTURE.md` only if UI in scope.
3. `/goal` until pass (defined in `ROLES.md`). **Fixable** = Spec mismatch or verify failure that can be corrected without expanding Out of scope or changing Requirement. At most **one** fix→push→re-verify cycle; if still failing, unrecoverable blocker.
4. If pushed: re-run Bugbot 0 High + CI green before declaring ready (Reviewer `ok: true` alone is not enough after a push).
5. Pass → stop. Human merges. No Linear state change.

## Stop early only when

- User asked for one phase
- PR already ready — await merge
- **Unrecoverable blocker** — stop and report finished work + URLs. Counts as unrecoverable:
  - No `## Requirement` (Linear MCP missing and user did not paste it)
  - PR trust fails (zero/ambiguous/foreign PR)
  - Allowlisted verify still failing after **one** Spec-aligned fix→re-verify cycle
  - Bugbot cannot run after one retry
  - A CI check is `fail` / `failure` / `cancelled` / `timed_out` and remains so after at most 3 fix+push cycles (unless that check is named in Spec Out of scope)
  - User withholds confirmation required for a Requirement text change
  - Reviewer `/goal` still failing after one fixable fix→push→re-verify cycle

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
