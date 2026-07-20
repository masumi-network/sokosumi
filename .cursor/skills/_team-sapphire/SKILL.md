---
name: _team-sapphire
description: Run the Sapphire squad on a single Linear issue — Investigator, Tech Lead, Coder(s), Reviewer — from requirement through PR and /goal until In Review. Use when the user says run team-sapphire or Sapphire for SOK-XXX, or when a Linear issue has ## Requirement and they want the squad to implement it.
disable-model-invocation: true
---

# Team Sapphire

You are the **Sapphire orchestrator**. One Linear issue. Four phases. **Do not stop after one phase** — run through **In Review** in this session unless the user asked for a single phase or you hit an unrecoverable blocker.

```mermaid
flowchart LR
  inv[Investigator] --> lead[Tech Lead]
  lead --> code[Coder]
  code --> gates[CI + Bugbot]
  gates --> rev[Reviewer]
  rev --> ir[In Review]
```

## Who runs what

| Phase | Default runner | Subagent |
|-------|----------------|----------|
| Investigator | Orchestrator | — |
| Tech Lead | Orchestrator | Optional `sapphire-tech-lead` (inherits parent model) |
| Coder | **Always** `sapphire-coder` | Required — pin `composer-2.5` |
| Reviewer | Orchestrator | Optional `sapphire-reviewer` for UI-heavy `/goal` (inherits parent model) |

**Models:** Only **Coder** pins a model (`composer-2.5` in agent frontmatter). Tech Lead / Reviewer agents omit `model` so Task inherits the orchestrator. When launching Coder via Task, always pass `model: composer-2.5`. Do **not** pass `model` for Tech Lead or Reviewer Tasks.

**Orchestrator owns:** all Linear writes, CI watch, Bugbot, status table, **In Review**. Subagents never call Linear MCP.

## Artifacts (Linear comments)

Investigation and spec live as **comments** (not the issue description). Resume loads them via `list_comments`.

| Header | Body |
|--------|------|
| `**Sapphire · Investigation**` | Full investigation markdown |
| `**Sapphire · Spec**` | Full spec markdown |

Issue description holds only `## Requirement`, `## Sapphire status`, and footer. Strip legacy `## Investigation` / `## Spec` sections on the next status write.

## Subagent return shape

Subagents return structured fields — **no** draft Linear comments, **no** Linear MCP:

```text
ok: true|false
prUrl: <url or empty>
branch: <name>
verification: <commands + exit 0>
pushed: true|false
summary: <one line>
blocker: <text if ok false>
```

Coder (sole): also opens the PR. Parallel coders: return `branch` only (no push/PR). Reviewer: set `pushed: true` if commits landed on the PR branch.

## Intake

1. `get_issue` — require `## Requirement`.
2. If still **Triage** → `state: "In Progress"`.
3. If `## Sapphire status` missing → insert initial table (`LINEAR.md`), then start Investigator.
4. Else resume (below).

## Resume

Load newest `**Sapphire · Investigation**` / `**Sapphire · Spec**` comments into context.

| Condition | Action |
|-----------|--------|
| User asked for one phase only | Run that phase + exit gate; stop |
| Status row `done` + artifact comment exists | Skip that phase |
| Status `done` but artifact comment missing | Re-run that phase (and upstream if needed) |
| Coder `done` + complete comment has verification/CI/Bugbot 0 High + open PR + spec artifact | Skip Coder; run Reviewer |
| PR open + Coder `done` but complete comment incomplete | **Gate repair** — run missing Pre-Reviewer gates; post/update Coder complete; do not re-implement unless a gate fails |
| All rows `done`, not **In Review** | Finish Reviewer + Completion gate |
| All rows `done` + **In Review** | Exit gate; stop — await human merge |

Then continue **all later phases** in this session.

## Phase 1 — Investigator

1. Read `ROLES.md` (Investigator). Flag `BUGBOT-LEARNINGS.md` R1–R12 triggers.
2. Produce investigation (patterns, pitfalls, open questions — not a final spec).
3. **Gate:** `save_comment` → `**Sapphire · Investigation**` (full body). `save_issue` → Investigator `done`.
4. Continue to Phase 2.

## Phase 2 — Tech Lead

1. Read `ROLES.md` (Tech Lead), `SPEC-TEMPLATE.md`, `SUBAGENT-RUBRIC.md`. Inputs: Requirement + Investigation artifact.
2. Run on orchestrator (or optional `sapphire-tech-lead`). Output full spec — always include **Data flow**. Default **one coder**; parallel only per rubric.
3. **Gate:** `save_comment` → `**Sapphire · Spec**` (full body; first lines: coder count + order). `save_issue` → Tech Lead `done`.
4. Continue to Phase 3.

## Phase 3 — Coder

1. Read Spec artifact (+ Investigation if needed). Read `ROLES.md` (Coder) and `BUGBOT-LEARNINGS.md`.
2. **Single coder (default):** Task `sapphire-coder` (`model: composer-2.5`) with coder block + issue id. Subagent implements, verifies (exit 0), opens **one PR**, returns structured fields.
3. **Multiple sequential:** run coders in execution order on one branch (one Task after another, or sole Task with full scope). One PR at the end.
4. **Parallel (`**Parallel:** true` + ownership table only):** parallel `sapphire-coder` Tasks — each commits on a named branch, **no PR**. Orchestrator merges → verify → one PR.
5. **Pre-Reviewer gates (orchestrator):** (1) local verify exit 0 (already done by implementer) (2) PR open (3) CI green (`gh pr checks`) (4) Bugbot **0 High** (`BUGBOT-LEARNINGS.md`). Fix High on branch; re-run until clear.
6. **Gate:** one `save_comment` → `**Sapphire · Coder complete**` (template in `GATES.md`). If ≥1 Medium: also `**Bugbot · medium (human review)**`. Then `save_issue` → Coder `done`. Stay **In Progress**.
7. Continue to Phase 4.

## Phase 4 — Reviewer

1. Entry: Coder complete documents verification exit 0, CI green, Bugbot 0 High — else return to Phase 3.
2. Read Spec artifact + `ROLES.md` (Reviewer). UI evidence: `VISUAL-CAPTURE.md`.
3. Run `/goal` on orchestrator (or optional `sapphire-reviewer` for UI-heavy). Fix on PR branch when needed.
4. If Reviewer pushed: re-run Bugbot 0 High + confirm CI green.
5. **Gate:** `save_comment` → `**Sapphire · Reviewer complete**`. `save_issue` → Reviewer `done`. Then `save_issue` → `state: "In Review"` only. Do not mark **Done**.

## Exit gate

Before returning to the user: `get_issue` + `list_comments` per `GATES.md`. Repair missing comments/status/state. Do not report success with a stale table.

## Stop early only when

- User asked for a single phase
- Issue already **In Review** and Reviewer `done` (exit gate, then await merge)
- Unrecoverable blocker (no GitHub, Linear MCP down, impossible spec) — report what finished and the issue URL

## Supporting files (read when needed)

| File | When |
|------|------|
| `ROLES.md` | Each phase |
| `GATES.md` | Before any phase gate / exit |
| `LINEAR.md` | Before Linear writes |
| `SPEC-TEMPLATE.md` / `SUBAGENT-RUBRIC.md` | Tech Lead |
| `BUGBOT-LEARNINGS.md` | Investigator flags; Coder/Bugbot gates |
| `VISUAL-CAPTURE.md` | Reviewer UI evidence |
| `CURSOR-AUTOMATION.md` | Optional Cloud trigger setup |
