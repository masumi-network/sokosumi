---
name: _team-sapphire
description: Run the Sapphire squad on a single Linear issue — Investigator, Tech Lead, Coder(s), and Reviewer — in one session from requirement through PR and /goal review until In Review. Mandatory phase gates (comment + status table per phase) per PHASE-GATE.md. Use when the user says run team-sapphire or Sapphire for SOK-XXX, or when a Linear issue already has a ## Requirement and they want the squad to implement it.
disable-model-invocation: true
---

# Team Sapphire

You are the **Sapphire orchestrator**. One Linear issue. Four roles. No child issues.

Run the squad in order on the **same issue** the user points at (any SOK issue with a requirement body).

## Continuous orchestration (critical)

**Do not stop after one phase.** You are the orchestrator — run every remaining phase in **this same agent session** until the pipeline finishes or you hit an unrecoverable blocker.

**Do not batch Linear updates.** Each phase ends with a **blocking gate** before the next phase starts — typically `save_comment` then `save_issue` to mark the row `done` (Coder: Pre-Reviewer gates pass, then `**PR handoff**`; optional `**Bugbot · medium (human review)**` when ≥1 Medium; `**Sapphire · Coder complete**` with verification, CI, Bugbot summary; then `save_issue`). See `PHASE-GATE.md`. Skipping gates (e.g. only posting a final Reviewer comment while the status table stays `pending`) is a **failed run** — repair before exit.

| After phase completes | Next action |
|----------------------|-------------|
| Investigator → `done` | **Immediately** start Phase 2 (Tech Lead) — do not return to the user yet |
| Tech Lead → `done` | **Immediately** start Phase 3 (Coder) |
| Coder → `done` + valid `**Sapphire · Coder complete**` (verification exit 0, CI green, Bugbot 0 High) + PR open | **Immediately** start Phase 4 (Reviewer) |
| Reviewer → `done` | Run **Completion** gate — comment, all status rows `done`, then `state: "In Review"`; then **Exit gate** (`PHASE-GATE.md`); return summary to user |

**Only stop early when:**

- Issue is already **In Review** and Reviewer is `done` — run **Exit gate** first; on pass, await human merge.
- User explicitly asked to run a single phase only (e.g. `run investigator for SOK-XXX`) — run **Exit gate** for completed rows, then stop.
- Unrecoverable blocker (no GitHub access, Linear MCP down, spec impossible) — report what finished, what is blocked, and the issue URL (Exit gate when Linear MCP is available).

**Never** treat Investigator, Tech Lead, or Coder as standalone jobs when you were invoked as `_team-sapphire` on a full issue. Phase comments (`**Sapphire · … complete**`) mark progress — they are **not** exit signals.

Resume runs: pick start phase with **artifact-aware resume** (below) — not status table alone — then **continue through all later phases in the same session** unless a stop condition above applies.

## Runtime

| Agent | How to use |
|-------|------------|
| Cursor | Load `.cursor/skills/_team-sapphire/SKILL.md`. |
| Claude Code / Codex | Read this file and linked docs in this directory. |

## Defaults

| Field | Value |
|-------|-------|
| Repo hint | `[repo=masumi-network/sokosumi]` — Tech Lead puts at top of **session spec** (not Linear) |
| Linear team | `SOK` |
| Linear project | `Sokosumi` |
| Issue model | **Single issue** — `## Requirement` + `## Sapphire status` on Linear; investigation and spec stay **in session** only |

## Role models

Investigator runs on the **orchestrator model** (no override). Phases 2–4 delegate to subagents — use `/sapphire-tech-lead`, `/sapphire-coder`, `/sapphire-reviewer` or Task with the same `model` slug.

| Role | Subagent |
|------|----------|
| Tech Lead | `sapphire-tech-lead` |
| Coder(s) | `sapphire-coder` |
| Reviewer | `sapphire-reviewer` |

Subagent definitions: `.cursor/agents/sapphire-*.md`. When launching Task subagents for coders, always pass `model: composer-2.5`.

## Session artifacts (critical)

Investigation and spec are **working documents for this agent run**. Keep them in orchestrator context and pass them to the next phase — **do not** write `## Investigation` or `## Spec` to the Linear issue description.

| Artifact | Produced by | Passed to | On Linear |
|----------|-------------|-----------|-----------|
| Investigation | Investigator | Tech Lead (same session) | Comment summary only |
| Spec | Tech Lead | Coder, Reviewer (same session) | Comment summary only |
| Requirement | On Linear issue (unchanged) | All phases | Description (unchanged) |
| Status table | Orchestrator | Resume / humans | Description |

When updating Linear, merge **only** `## Requirement`, `## Sapphire status`, and the Sapphire footer. Strip legacy `## Investigation` / `## Spec` blocks if present — do not re-add them.

**Resume in a new session:** `## Sapphire status` shows progress, but investigation/spec are not on Linear. A row marked `done` does **not** skip a phase when its session artifact is missing — rebuild artifacts before downstream phases (Investigator → Tech Lead → Coder/Reviewer).

## Intake

- Required: Linear issue id/URL (e.g. `SOK-XXX`) — user points at an issue with `## Requirement`.
- Optional: start phase (`investigator`, `tech-lead`, `coder`, `reviewer`) when resuming a stalled run — still apply **artifact-aware resume** when downstream phases need session investigation or spec (unless user explicitly asked to run that phase only).
- Load issue with `get_issue`. Read `## Requirement` (or requirement body before Sapphire sections exist).
- If issue state is **Triage**, set `state: "In Progress"` when Sapphire work starts (state-only `save_issue` is fine).
- If `## Sapphire status` is **missing**, insert the initial status block per `LINEAR-MCP.md` (full-description merge via `save_issue`) **first** — do not run resume or cleanup rules until the table exists; then start Investigator (or the user’s explicit start phase).
- If `## Sapphire status` is present, compute start phase with **artifact-aware resume** (do not use status table alone). Initialize `mode` = **full** (default).
  1. Set `target` = user start phase if specified, else first row not `done` (Investigator → Tech Lead → Coder → Reviewer).
  2. If user explicitly requested **that phase only** (e.g. `run investigator for SOK-XXX`) → run `target`, then **Exit gate**, then stop.
  3. If `target` is Coder or Reviewer and there is no **session spec** in this run → set `target` to **Tech Lead** (even when Tech Lead = `done` on Linear).
  4. If `target` is Tech Lead or later and there is no **session investigation** in this run → set `target` to **Investigator** (even when Investigator = `done` on Linear).
  5. If `target` is **Coder** or **Reviewer**, `**session spec**` is in context, `**PR handoff**` + open PR + Coder = `done`, but `**Sapphire · Coder complete**` is missing or lacks verification / CI / Bugbot fields → set `target` to **Coder**, `mode` to **gate repair only**. Do **not** set `target` to Reviewer. (When **session spec** is missing, steps 3–4 keep `target` on Tech Lead or Investigator — do not enter gate repair.)
  6. If **every** status row is already `done` and issue is **not** `In Review` → **Reviewer cleanup**: rebuild session spec via Tech Lead (and Investigator if needed) when missing; if `**Sapphire · Coder complete**` is missing or invalid → set `target` to **Coder**, `mode` to **gate repair only**; else set `target` to **Reviewer**. Phase 4 runs only via step 8 when `target` is **Reviewer** and Coder complete is valid (`REVIEWER.md`, post-fix Bugbot + CI when Reviewer pushed, **Completion** gate, **Exit gate**).
  7. If **every** status row is `done` and issue is **`In Review`** → run **Exit gate**; on pass, stop — await human merge.
  8. Run from `target` through all later phases in this session. When `mode` = **gate repair only**, Phase 3 uses **gate repair path** (not full implementation path).

## Workflow

See `WORKFLOW.md`. Role details: `INVESTIGATOR.md`, `TECH-LEAD.md`, `CODER.md`, `REVIEWER.md`. Linear updates: `LINEAR-MCP.md`. UI evidence: `VISUAL-CAPTURE.md`.

### Phase 1 — Investigator

1. Run Investigator per `INVESTIGATOR.md` (codebase search, pitfalls, patterns — **not** a final spec).
2. Keep the investigation markdown **in session** — pass the full text to Tech Lead. Do **not** merge `## Investigation` into the Linear description.
3. **Gate (blocking):** `save_comment` → `**Sapphire · Investigator complete**` (3–5 bullets). Then `save_issue` → Investigator row `done`. Do **not** open Phase 2 until both succeed (`PHASE-GATE.md`).
4. **Continue in this run** — proceed to Phase 2 without stopping.

### Phase 2 — Tech Lead

1. Delegate to **`sapphire-tech-lead`** with Requirement (Linear) + Investigation (**session**).
2. Receive final spec per `SPEC-TEMPLATE.md` and `SUBAGENT-RUBRIC.md`.
3. Keep the spec markdown **in session** — pass the full text to Coder and Reviewer. Do **not** merge `## Spec` into the Linear description.
4. **Gate (blocking):** `save_comment` → `**Sapphire · Tech Lead complete**` (coder count, order, 3–5 bullets). Then `save_issue` → Tech Lead row `done`. Do **not** open Phase 3 until both succeed.
5. **Continue in this run** — proceed to Phase 3 without stopping.

### Phase 3 — Coder(s)

**Gate repair path** (`mode` = **gate repair only**): `**PR handoff**` + open PR + Coder = `done` on Linear, but `**Sapphire · Coder complete**` missing or incomplete. Requires **session spec** in context (intake steps 3–4 run first when missing). Triggered by intake step 5 or Reviewer cleanup. **Do not** run full-path steps 2–4 below.

1. Read **session spec** (plus session investigation for context). Requirement from Linear when needed.
2. Resolve PR from `**PR handoff**` (branch via `gh`).
3. Run each **missing** Pre-Reviewer gate 1–4 in order (`CODER.md`): local verification exit 0 → PR open (usually already done) → CI green → Bugbot 0 High.
4. Post or update Phase gate Linear comments per `CODER.md` **Phase gate (blocking)**.
5. **Continue in this run** — proceed to Phase 4 without stopping.

**Full implementation path** (`mode` = **full**, default):

1. Read **session spec** (plus session investigation for context). Requirement from Linear when needed.
2. If Tech Lead defined multiple coders with parallel ownership, launch **parallel** **`sapphire-coder`** Task subagents (`model: composer-2.5`) — one per coder block. Each subagent implements and returns branch/commits; **subagents do not open PRs**. After all return, orchestrator merges onto one integration branch, runs allowlisted verification on the merged branch (exit 0), and opens **one PR**.
3. If single coder, delegate to **`sapphire-coder`** (`model: composer-2.5`) — subagent implements, runs allowlisted verification (exit 0), opens **one PR**, and returns draft handoff text. **Orchestrator skips** duplicate verification and PR open.
4. **Pre-Reviewer gates 3–4 (blocking, after PR exists):** **Gate runner** watches **CI green** on the PR (`gh pr checks`) and runs **mandatory Bugbot** with **zero High** findings (fix High on branch; medium acknowledged only). Gates 1–2 complete in steps 2–3 (local verification exit 0, then PR open). Subagents do **not** run CI or Bugbot. See `CODER.md` **Pre-Reviewer gates** and `BUGBOT-LEARNINGS.md`.
5. **Phase gate (blocking):** After step 4 passes — `save_comment` → `**PR handoff**`. If Bugbot reported ≥1 Medium: `save_comment` → `**Bugbot · medium (human review)**` (table for human merge pass). Then `save_comment` → `**Sapphire · Coder complete**` (verification, CI, Bugbot summary). Then `save_issue` → Coder row `done`. Stay **In Progress** — do not set In Review yet. Do **not** open Phase 4 until step 5 succeeds.
6. **Continue in this run** — proceed to Phase 4 without stopping.

### Phase 4 — Reviewer

1. Confirm Coder complete comment documents **local verification exit 0**, **CI green**, and **Bugbot 0 High** — otherwise return to Phase 3.
2. Delegate to **`sapphire-reviewer`** (`model: gpt-5.5-medium`) — run `/goal` per `REVIEWER.md` until all criteria pass.
3. For UI specs, capture evidence per `VISUAL-CAPTURE.md` (Cloud: PR artifacts; IDE: screenshots; optional CLI for WebM).
4. Fix on PR branch when needed; loop.
5. **Post-fix gates (blocking when Reviewer pushed commits):** Re-run mandatory Bugbot until **0 High** and confirm **CI green** on the PR before Completion gate (`REVIEWER.md` step 7).
6. **Gate (blocking):** On pass — `save_comment` → `**Sapphire · Reviewer complete**` with evidence; `save_issue` → Reviewer row `done` (full description merge); then `save_issue` → `state: "In Review"` only. All four status rows must be `done` before exit.
7. Do **not** mark issue **Done** — human merges PR.

### Exit gate (blocking)

Before returning to the user, run **Exit gate** in `PHASE-GATE.md`: `get_issue` + `list_comments`. Verify every `done` row has matching comment(s) and issue state matches ( **In Review** when Reviewer row is `done`). If anything fails, **repair retroactively** — do not report success with a stale `pending` table or wrong state.

## MCP

- Read `PHASE-GATE.md` before the first phase — gates are blocking.
- Read `BUGBOT-LEARNINGS.md` before Phase 1 (Investigator R1–R12 flags) and before Coder Pre-Reviewer gates (CI + Bugbot).
- Read `LINEAR-MCP.md` before any write.
- Health check before first call — if `user-linear` is missing, stop with the reload message in `LINEAR-MCP.md`.
- Use `save_issue` for **status table**, **state**, and legacy section cleanup only — not investigation or spec; use `save_comment` for phase markers.

## Resume and idempotency

Use `## Sapphire status` for progress on Linear; **session artifacts** decide whether a `done` row can be skipped. Legacy `## Investigation` / `## Spec` on Linear (older runs) are ignored — strip on the next status write.

| Condition | Action |
|-----------|--------|
| Same session — Investigator = done + **session investigation** in context | Skip Investigator unless user asked to re-run |
| Same session — Tech Lead = done + **session spec** in context | Skip Tech Lead unless user asked to re-spec |
| New session — Investigator = `done` on Linear but no **session investigation** | Re-run Investigator before Tech Lead |
| New session — Tech Lead = `done` on Linear but no **session spec** | Re-run Tech Lead before Coder or Reviewer (Investigator first if investigation missing) |
| `**Sapphire · Coder complete**` documents verification exit 0, CI green, Bugbot 0 High + open PR + Coder = `done` + **session spec** in context | Skip Coder implementation; run Reviewer |
| `**PR handoff**` + open PR + Coder = `done`, missing or incomplete `**Sapphire · Coder complete**` + **session spec** in context | **Gate repair only** — run missing Pre-Reviewer gates 1–4 (local verification exit 0, CI green, Bugbot 0 High); post/update Phase 3 comments per `CODER.md`; do **not** re-implement unless gates fail |
| `**PR handoff**` + open PR, no **session spec** (new session) | Re-run Tech Lead before gate repair or Reviewer (Investigator first if investigation missing) |
| All status rows = `done`, issue not `In Review` | Reviewer cleanup — rebuild session spec when missing; if Coder complete invalid → **gate repair only** via step 8; if valid → Phase 4 + post-fix gates + **Completion** gate + **Exit gate** |
| Issue `In Review` + Reviewer done | **Exit gate**; on pass, stop — await human merge |

## Output

Return issue id/URL, **all phases completed in this run**, PR link (if any), and current Linear state. If you stopped early, say which phase blocked and why — stopping after Investigator alone is a failure unless the user asked for a single phase.

## Supporting files

- `PHASE-GATE.md` — blocking comment + status writes per phase; exit verification
- `BUGBOT-LEARNINGS.md` — R1–R12 quality rules; mandatory Bugbot (fix High only)
- `WORKFLOW.md` — pipeline diagram and status lifecycle
- `INVESTIGATOR.md`, `TECH-LEAD.md`, `CODER.md`, `REVIEWER.md` — role contracts
- `SPEC-TEMPLATE.md` — Tech Lead output shape
- `SUBAGENT-RUBRIC.md` — when to split coders
- `LINEAR-MCP.md` — single-issue updates
- `VISUAL-CAPTURE.md` — Reviewer screenshots and screen recordings
- `CURSOR-AUTOMATION.md` — optional Linear-triggered Cloud Agent setup
