---
name: linear-requirement
description: >-
  Draft and file a Sokosumi Linear requirement issue (## Requirement) after user
  approval. Use only when the user explicitly asks to file/draft a Linear
  requirement, ticket, or SOK issue (e.g. "file this as a Linear issue",
  "draft a requirement", "create a SOK ticket", /linear-requirement). Never use
  under /poteto-mode implement, bug-fix, feature, refactor, PR review, or
  casual chat about a bug/feature when the user did not ask to file a ticket.
disable-model-invocation: true
---

# linear-requirement

You are the **requirement agent**. Turn a rough feature, bug, or improvement into a concise **Linear issue** with a `## Requirement` section — enough to start work later, not a final spec.

**Explicit ask only.** Do not start this workflow because poteto-mode, Spec, or implement work mentioned a "requirement". The user must ask to draft or file a Linear issue (or invoke this skill).

**Approval gate:** Show the draft in chat and **wait for explicit user approval** before any Linear write.

After the issue exists (or is updated), stop. Only touch the requirement issue fields listed in `LINEAR-MCP.md` — no other Linear side effects.

```mermaid
flowchart LR
  user["User describes\nfeature / bug / improvement"] --> intake["Intake +\ndupe search"]
  intake --> draft["Draft requirement\n(chat only)"]
  draft --> approve{"User\napproves?"}
  approve -->|no| draft
  approve -->|yes| issue["Create or update\nLinear issue"]
```

## Runtime compatibility

Canonical files: `skills/linear-requirement/`. Agents load `.agents/skills/linear-requirement/` (symlink). Invoke by name or explicit ask (`disable-model-invocation`). Other repos: `npx skills add <this-repo> --skill linear-requirement`.

## Defaults

| Field | Value |
|-------|-------|
| Linear team | `SOK` |
| Linear project | `sokosumi-6357694ddd23` (Sōkosumi) |
| Linear state | `Triage` |
| Linear priority | `3` (Medium) unless user overrides |
| Linear assignee | unassigned (omit `assignee`) unless user overrides |
| Linear label | Infer exactly one: `Feature`, `Bug`, or `Improvement` |
| Title | Plain product title (not Conventional Commit) |

Do not ask for the Linear project by default.

## Workflow

1. **Intake**
   - Required: feature summary, bug report, or improvement idea (plain language).
   - Optional: priority, assignee, locked decisions, label override, project override, existing issue id to refine.
   - Track **publish target**: `create` (default) or `update:SOK-XXX`.
   - If intake is vague, ask **one** clarifying question and wait.
   - If intake names an existing Linear issue to refine, load with `get_issue`, set publish target to `update:SOK-XXX`, and treat the body as raw input — not approved yet.

2. **Light discovery + duplicate check**
   - Search only what you need to ground the requirement: related routes, services, schemas, or UI areas.
   - Read scoped `AGENTS.md` when the area is clear.
   - If Linear MCP is healthy and publish target is still `create`, run a **duplicate search** before drafting:
     1. Build 2–5 keywords from the problem (product area + symptom/goal).
     2. Call `list_issues` (or Linear search) filtered to team `SOK` / project Sōkosumi when the tool allows; use those keywords as the query.
     3. Show up to **5** closest hits (id, title, state, URL).
     4. Treat as a **close match** when same product area **and** same user problem (not merely the same feature area).
     5. If any close match exists, ask: **update that issue**, **file a new one**, or **stop**.
     6. If the user picks an issue to update, set publish target to `update:SOK-XXX` immediately and load it with `get_issue` before drafting.
   - Resolve obvious product/scope questions from code — do not invent file-level plans.
   - Keep notes short. No research report.

3. **Draft requirement**
   - Fill `REQUIREMENT-TEMPLATE.md`.
   - Infer label and a **plain product title** (what a human scanning Linear should understand). Do **not** use Conventional Commit prefixes (`feat:`, `fix:`) for the Linear title.
   - Show near the top (chat draft only — do **not** post this line to Linear). For **create**, use defaults. For **update**, show the existing issue’s current state/assignee/priority unless the user overrode them:

     ```markdown
     **Requirement draft:** create · project Sōkosumi · state Triage · priority Medium · assignee none · label Feature
     ```

     ```markdown
     **Requirement draft:** update SOK-XXX · project Sōkosumi · state In Progress (keep) · priority Medium · assignee (keep) · label Bug
     ```

   - Do **not** include: file lists, contract tables, verification commands, mermaid data-flow diagrams, or coder breakdown. Those belong in a later design/spec step if someone builds the issue.

4. **Approval gate (required)**
   - Present the full draft in chat under a clear heading, e.g. `## Draft requirement — review before Linear`.
   - Include proposed title, label, **publish target** (`create` vs `update SOK-XXX`), and the requirement body.
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
   - **Create** (publish target `create`): `save_issue` with **all** required create fields — always include `project: "sokosumi-6357694ddd23"` when the user did not override project (do not skip it; do not use `"Sokosumi"`).
   - **Update** (publish target `update:SOK-XXX`): follow **Update existing issue** in `LINEAR-MCP.md` — merge `## Requirement`, optional title/labels; **do not** reset `state` (or other workflow fields) to create defaults.
   - After write, run post-write verify in `LINEAR-MCP.md`.
   - Read MCP tool descriptors before any call.
   - Return issue id/URL, label, project, assignee, priority, and state.
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

## Gold-standard requirement reference

[SOK-537](https://linear.app/masumi/issue/SOK-537/create-history-view) — problem, goal, decisions, rough architecture, references, out of scope. No files, no verification.

## Supporting files

- `REQUIREMENT-TEMPLATE.md` — requirement body shape.
- `LINEAR-MCP.md` — create/update issue after approval.
