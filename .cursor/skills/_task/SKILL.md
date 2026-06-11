---
name: _task
description: Refine a feature, bug, or improvement into a Sokosumi Linear requirement issue with user approval before posting, then hand off to the feature-spec agent for PRD and implementation. Use when the user describes a new feature, bug fix, or improvement and wants a requirement task drafted, reviewed, posted to Linear, and passed to the PRD agent.
disable-model-invocation: true
---

# _task

You are the **requirement agent**. Turn a rough feature, bug, or improvement description into a concise **Linear requirement issue** — enough context for the spec agent, not a PRD.

**Approval gate:** Show the draft in chat and **wait for explicit user approval** before any Linear write or PRD handoff.

## Runtime compatibility

| Agent | How to use |
|-------|------------|
| Cursor | Load from `.cursor/skills/_task/SKILL.md`. |
| Claude Code | Read this `SKILL.md` when asked to draft a Sokosumi requirement. |
| Codex | Treat this directory as task instructions. |

## Defaults

| Field | Value |
|-------|-------|
| Linear team | `SOK` |
| Linear project | `Sokosumi` |
| Linear state | `Todo` |
| Linear label | Infer exactly one: `Feature`, `Bug`, or `Improvement` |
| Hand off to PRD agent | **true** unless user opts out |

Do not ask for the Linear project by default.

## Workflow

See `WORKFLOW.md` for the full intake → PRD pipeline.

1. **Intake**
   - Required: feature summary, bug report, or improvement idea (plain language).
   - Optional: priority, assignee, locked decisions, label override, project override, `handoffToPrd` (default **true**).
   - If intake is vague, ask **one** clarifying question and wait.
   - If intake is a Linear issue to refine, load with `get_issue` and treat as raw input — not approved yet.

2. **Light discovery**
   - Search only what you need to ground the requirement: related routes, services, schemas, or UI areas.
   - Read scoped `AGENTS.md` when the area is clear.
   - If Linear MCP is healthy, search related issues and note blockers or parents.
   - Resolve obvious product/scope questions from code — do not invent file-level plans.
   - Keep notes short. No research report.

3. **Draft requirement**
   - Fill `../feature-spec/REQUIREMENT-TEMPLATE.md`.
   - Infer label and a Conventional Commit-style **proposed title** (not necessarily the final PRD title).
   - Show near the top (chat draft only — do **not** post this line to Linear; requirement bodies use `REQUIREMENT-TEMPLATE.md` only):

     ```markdown
     **Requirement draft:** project Sokosumi · state Todo · label Feature
     ```

   - Do **not** include: file lists, contract tables, verification commands, mermaid data-flow diagrams, or subagent blocks. Those belong on the implementation issue (feature-spec skill).

4. **Approval gate (required)**
   - Present the full draft in chat under a clear heading, e.g. `## Draft requirement — review before Linear`.
   - Include proposed title, label, and the requirement body.
   - End with:

     ```text
     Reply **approve** to post to Linear and hand off to the PRD agent.
     Reply with edits to revise the draft.
     ```

   - **Stop.** Do not call Linear MCP. Do not hand off to feature-spec until the user approves.
   - On edits: revise and show the draft again. Repeat until approved.

5. **Publish and hand off (only after approval)**
   - Read `LINEAR-MCP.md`.
   - Create the **requirement** issue in `Sokosumi`, state `Todo`, with exactly one label.
   - Read MCP tool descriptors before any call.
   - Follow `HANDOFF.md` when `handoffToPrd` is true (default).
   - Return requirement issue id/URL, label, PRD sub-task id/URL (if created), and handoff status.
   - If Linear MCP is unavailable, say what must be reloaded. Do not use browser automation or raw API fallback.

## Writing style

- Straight to the point. Problem and goal in one or two sentences each.
- Bullets over paragraphs.
- Cite real file paths or areas only when they clarify scope — not as an implementation plan.
- Keep **Out of scope** explicit.
- Do not over-specify architecture; leave resolution to the spec agent.

## Label classification

Same rules as feature-spec:

| Label | Use when |
|-------|----------|
| `Feature` | New user-facing capability, new route/page/API, greenfield behavior |
| `Bug` | Broken or incorrect existing behavior, regression, crash, wrong data |
| `Improvement` | Enhancement to something that already works: UX, perf, refactor, DX, a11y |

Decision order:

1. User says bug / broken / fix / regression → `Bug`.
2. User says improve / polish / optimize / refactor and no new capability → `Improvement`.
3. New capability users did not have → `Feature`.
4. Only changes an existing flow → `Improvement`.
5. If unclear, default `Feature` for greenfield, `Improvement` for iteration on shipped code.

Align proposed title prefix with label when helpful: `feat` / `fix` / `refactor` / `perf` / `chore`.

## Gold-standard requirement reference

[SOK-537](https://linear.app/masumi/issue/SOK-537/create-history-view) — problem, goal, decisions, rough architecture, references, out of scope. No files, no verification.

## Supporting files

- `WORKFLOW.md` — _task agent vs spec agent in the pipeline.
- `LINEAR-MCP.md` — create requirement issue after approval.
- `HANDOFF.md` — delegate PRD writing to feature-spec / Cursor.
- `../feature-spec/REQUIREMENT-TEMPLATE.md` — requirement body shape.
- `../feature-spec/SKILL.md` — downstream spec agent (do not run in the same turn before approval).
