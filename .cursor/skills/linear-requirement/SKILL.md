---
name: linear-requirement
description: Refine a feature, bug, or improvement into a Sokosumi Linear issue with a ## Requirement section. Draft in chat, wait for user approval, then post to Linear. Use when the user describes a new feature, bug fix, or improvement and wants a requirement drafted and filed as a Linear issue — or when they ask to create, draft, or file a Sokosumi / SOK requirement or ticket.
---

# linear-requirement

You are the **requirement agent**. Turn a rough feature, bug, or improvement into a concise **Linear issue** with a `## Requirement` section — enough to start work later, not a final spec.

**Approval gate:** Show the draft in chat and **wait for explicit user approval** before any Linear write.

After the issue exists, stop. Do not open PRs or set Linear `delegate`.

## Runtime compatibility

| Agent | How to use |
|-------|------------|
| Cursor | Load from `.cursor/skills/linear-requirement/SKILL.md`. |
| Claude Code | Read this `SKILL.md` when asked to draft a Sokosumi requirement. |
| Codex | Treat this directory as task instructions. |

## Defaults

| Field | Value |
|-------|-------|
| Linear team | `SOK` |
| Linear project | `sokosumi-6357694ddd23` (Sōkosumi) |
| Linear state | `In Progress` |
| Linear priority | `3` (Medium) unless user overrides |
| Linear assignee | `me` unless user overrides |
| Linear label | Infer exactly one: `Feature`, `Bug`, or `Improvement` |

Do not ask for the Linear project by default.

## Workflow

See `WORKFLOW.md`.

1. **Intake**
   - Required: feature summary, bug report, or improvement idea (plain language).
   - Optional: priority, assignee, locked decisions, label override, project override.
   - If intake is vague, ask **one** clarifying question and wait.
   - If intake is a Linear issue to refine, load with `get_issue` and treat as raw input — not approved yet.

2. **Light discovery**
   - Search only what you need to ground the requirement: related routes, services, schemas, or UI areas.
   - Read scoped `AGENTS.md` when the area is clear.
   - If Linear MCP is healthy, search related issues and note blockers or parents.
   - Resolve obvious product/scope questions from code — do not invent file-level plans.
   - Keep notes short. No research report.

3. **Draft requirement**
   - Fill `REQUIREMENT-TEMPLATE.md`.
   - Infer label and a Conventional Commit-style **proposed title** (not necessarily the final implementation title).
   - Show near the top (chat draft only — do **not** post this line to Linear):

     ```markdown
     **Requirement draft:** project Sōkosumi · state In Progress · priority Medium · assignee me · label Feature
     ```

   - Do **not** include: file lists, contract tables, verification commands, mermaid data-flow diagrams, or coder breakdown. Those belong in a later design/spec step if someone builds the issue.

4. **Approval gate (required)**
   - Present the full draft in chat under a clear heading, e.g. `## Draft requirement — review before Linear`.
   - Include proposed title, label, and the requirement body.
   - End with:

     ```text
     Reply **approve** to post this Linear requirement.
     Reply with edits to revise the draft.
     ```

   - **Stop.** Do not call Linear MCP until the user approves.
   - On edits: revise and show the draft again. Repeat until approved.

5. **Publish (only after approval)**
   - Read `LINEAR-MCP.md`.
   - Run MCP health check before any write.
   - Create via `save_issue` with **all** required fields from `LINEAR-MCP.md` — always include `project: "sokosumi-6357694ddd23"` when the user did not override project (do not skip it; do not use `"Sokosumi"`).
   - After create, run post-create verify in `LINEAR-MCP.md` (`get_issue` → patch missing defaults).
   - Read MCP tool descriptors before any call.
   - Return issue id/URL, label, project, assignee, priority, and state.
   - Do **not** set `delegate` or add sections beyond `## Requirement`.
   - If Linear MCP is unavailable, say what must be reloaded. Do not use browser automation or raw API fallback.

## Writing style

- Straight to the point. Problem and goal in one or two sentences each.
- Bullets over paragraphs.
- Cite real file paths or areas only when they clarify scope — not as an implementation plan.
- Keep **Out of scope** explicit.
- Do not over-specify architecture; leave design details for a later step.

## Label classification

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

- `WORKFLOW.md` — intake → approve → Linear issue.
- `REQUIREMENT-TEMPLATE.md` — requirement body shape.
- `LINEAR-MCP.md` — create issue after approval.
