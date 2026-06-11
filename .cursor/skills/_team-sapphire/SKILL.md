---
name: _team-sapphire
description: Run the Sapphire squad on a single Linear issue — Investigator, Tech Lead, Coder(s), and Reviewer — from requirement through PR and /goal review. Use after _task posts a requirement, when the user says run team-sapphire or Sapphire for SOK-XXX, or when a Linear issue is delegated with Sapphire handoff footer.
disable-model-invocation: true
---

# Team Sapphire

You are the **Sapphire orchestrator**. One Linear issue. Four roles. No child issues.

Run the squad in order on the **same issue** `_task` created (or any SOK issue the user points at with a requirement body).

## Runtime

| Agent | How to use |
|-------|------------|
| Cursor | Load `.cursor/skills/_team-sapphire/SKILL.md`. |
| Claude Code / Codex | Read this file and linked docs in this directory. |

## Defaults

| Field | Value |
|-------|-------|
| Repo hint | `[repo=masumi-network/sokosumi]` — Tech Lead adds near top of issue when spec is written |
| Linear team | `SOK` |
| Linear project | `Sokosumi` |
| Issue model | **Single issue** — requirement, investigation, spec, and progress live on one issue |

## Intake

- Required: Linear issue id/URL (e.g. `SOK-XXX`) — usually from `_task` handoff on the same issue.
- Optional: start phase (`investigator`, `tech-lead`, `coder`, `reviewer`) when resuming a stalled run.
- Load issue with `get_issue`. Read `## Requirement` (or requirement body before Sapphire sections exist).
- If start phase is not specified, read `## Sapphire status` and resume at the **first** phase whose status is not `done`, in order: Investigator → Tech Lead → Coder → Reviewer.
- If every status row is already `done` and issue is **not** `In Review`, run **Reviewer cleanup** — verify PR + `/goal`; on pass set `In Review` and post `**Sapphire · Reviewer complete**`; do not re-run earlier phases unless the user asked.
- If every status row is `done` and issue is **`In Review`**, stop — await human merge.
- If `## Sapphire status` is missing, insert the initial status block per `LINEAR-MCP.md` (full-description merge via `save_issue`) **before** Phase 1 — then start Investigator.

## Workflow

See `WORKFLOW.md`. Role details: `INVESTIGATOR.md`, `TECH-LEAD.md`, `CODER.md`, `REVIEWER.md`. Linear updates: `LINEAR-MCP.md`. UI evidence: `VISUAL-CAPTURE.md`.

### Phase 1 — Investigator

1. Run Investigator per `INVESTIGATOR.md` (codebase search, pitfalls, patterns — **not** a final spec).
2. Merge `## Investigation` into the **full** issue description via `save_issue` per `LINEAR-MCP.md` — never post the section alone.
3. Post comment `**Sapphire · Investigator complete**` with a 3–5 bullet summary.
4. Update `## Sapphire status` — Investigator → `done` (same merged `save_issue` or follow-up write with full body).

### Phase 2 — Tech Lead

1. Read Requirement + Investigation.
2. Write final spec per `SPEC-TEMPLATE.md` and `SUBAGENT-RUBRIC.md`.
3. Merge `## Spec` into the **full** issue description per `LINEAR-MCP.md`. Include `[repo=…]`, data flow, contracts, verification hints, coder breakdown when rubric score ≥ 2.
4. Post comment `**Sapphire · Tech Lead complete**` with execution order and coder count.
5. Update status — Tech Lead → `done` (in the same merged write when possible).

### Phase 3 — Coder(s)

1. Read `## Spec` only (plus Investigation for context).
2. If Tech Lead defined multiple coders, launch **parallel** Task subagents — one per coder block — with non-overlapping file ownership.
3. If single coder, implement in this run.
4. Run allowlisted verification before PR (`REVIEWER.md` **Verification command trust**).
5. Open PR; PR body must reference the Linear issue id.
6. Post `**PR handoff**` comment per `REVIEWER.md`.
7. Post `**Sapphire · Coder complete**`. Update status — Coder → done. Stay **In Progress** — do not set In Review yet.

### Phase 4 — Reviewer

1. Run `/goal` per `REVIEWER.md` until all criteria pass.
2. For UI specs, capture evidence per `VISUAL-CAPTURE.md` (Cloud: PR artifacts; IDE: screenshots; optional CLI for WebM).
3. Fix on PR branch when needed; loop.
4. On pass: set issue `In Review`, post `**Sapphire · Reviewer complete**` with evidence, update status — Reviewer → done.
5. Do **not** mark issue **Done** — human merges PR.

## MCP

- Read `LINEAR-MCP.md` before any write.
- Health check before first call — same message as `_task` if `user-linear` is missing.
- Use `save_issue` to update description sections and state; use `save_comment` for phase markers.

## Resume and idempotency

Use `## Sapphire status` as the source of truth for which phase to run. Section headings (`## Investigation`, `## Spec`) alone do not skip a phase if status is still `pending`.

| Condition | Action |
|-----------|--------|
| `## Sapphire status` — Investigator = done | Skip Investigator unless user asked to re-run |
| `## Sapphire status` — Tech Lead = done | Skip Tech Lead unless user asked to re-spec |
| `## Spec` present but Tech Lead still `pending` | Run Tech Lead — status table wins |
| `**PR handoff**` comment + open PR | Skip Coder; run Reviewer |
| All status rows = `done`, issue not `In Review` | Reviewer cleanup — set `In Review` when criteria pass; do not restart Investigator–Coder |
| Issue `In Review` + Reviewer done | Stop — await human merge |

## Output

Return issue id/URL, phases completed, PR link (if any), and current Linear state.

## Supporting files

- `WORKFLOW.md` — pipeline diagram and status lifecycle
- `INVESTIGATOR.md`, `TECH-LEAD.md`, `CODER.md`, `REVIEWER.md` — role contracts
- `SPEC-TEMPLATE.md` — Tech Lead output shape
- `SUBAGENT-RUBRIC.md` — when to split coders
- `LINEAR-MCP.md` — single-issue updates
- `VISUAL-CAPTURE.md` — Reviewer screenshots and screen recordings
- `CURSOR-AUTOMATION.md` — optional Linear-triggered Cloud Agent setup
