---
name: feature-spec
description: Draft concise Sokosumi implementation PRDs from requirements and hand off to Cursor Cloud Agent. Use when the user asks to write a PRD, feature spec, Linear task, architecture spec, implementation plan, subagent plan, spec agent, or SOK feature request — including when intake is a high-level Linear requirement issue, a Write PRD sub-task from `_task` handoff, or not yet a final plan.
disable-model-invocation: true
---

# Feature Spec

You are the **spec agent**. Turn requirements into a concise, Linear-ready **implementation PRD** for Sokosumi. The PRD is handed to a **coding agent** (Cursor Cloud Agent). It must be useful to an implementer, not a strategy memo.

A Linear issue that already lists feature and architectural decisions is usually **requirement input**, not the final plan. Read `WORKFLOW.md`. To create requirements from a rough idea with user approval first, use `../_task/SKILL.md`.

## Runtime compatibility

This skill is tool-agnostic. Use the same workflow in Cursor, Claude Code, and Codex.

| Agent | How to use |
|-------|------------|
| Cursor | Load this as a project skill from `.cursor/skills/feature-spec/SKILL.md`. |
| Claude Code | Read this `SKILL.md` directly when asked to write a Sokosumi feature spec. Follow linked local files in this directory. |
| Codex | Treat this directory as task instructions. Read `SKILL.md`, then `WORKFLOW.md`, `TEMPLATE.md`, `SUBAGENT-RUBRIC.md`, and `LINEAR-MCP.md` when needed. |

If an agent does not support Cursor skills, it must still follow this file as plain markdown instructions.

## Defaults

Use these unless the user overrides them:

| Field | Value |
|-------|-------|
| Linear team | `SOK` |
| Linear project | `Sokosumi` |
| Linear state | `Todo` |
| Linear label | Infer exactly one: `Feature`, `Bug`, or `Improvement` |

Do not ask for the Linear project by default. Ask only when the user explicitly wants a different project but does not name it.

## Workflow

See `WORKFLOW.md` for the full spec → code pipeline.

1. Intake
   - Required: feature summary **or** a Linear requirement issue id/URL (e.g. `SOK-537`) **or** a Write PRD sub-task id (default `_task` handoff — title `chore(spec): write implementation PRD`).
   - Optional: priority, milestone, assignee, blockers, locked decisions, label override, project override, `handoffToCursor` (default **true** when user wants auto coding agent).
   - If intake is a Linear issue, call `get_issue` and treat the description as requirements only — not an approved PRD.
   - **Write PRD sub-task path:** When the loaded issue title is `chore(spec): write implementation PRD`, keep that issue id as the intake sub-task (for idempotency comments), load the **parent requirement** via `get_issue`, and use the parent's description as requirements.
   - If nothing to work from, ask one question and wait.

2. Discovery
   - Search the relevant app/package areas before drafting.
   - Read nearby `AGENTS.md` files when the feature clearly touches a scoped area.
   - Find similar routes, services, schemas, actions, UI, migrations, or tests.
   - If Linear MCP is healthy, search related Linear issues and link blockers/dependencies.
   - Resolve open architecture questions from the requirement using real code paths.
   - Keep notes short. Use bullets. Do not write a research report.

3. Draft the PRD
   - Fill `TEMPLATE.md` (implementation issue shape).
   - Always include a `Data flow` mermaid diagram.
   - Include `Current state` and `Target architecture` only when the rubric in `SUBAGENT-RUBRIC.md` says to.
   - Split into subagent workstreams only when the rubric in `SUBAGENT-RUBRIC.md` says to.
   - Infer the Linear label and show it near the top:

     ```markdown
     **Linear:** project Sokosumi - state Todo - label Feature
     ```

   - When a requirement parent applies (direct requirement intake or Write PRD sub-task resolved to parent), note: `**Requirement:** SOK-XXX`
   - Do **not** wait for PRD approval. Confirmation is a non-blocking sub-task (step 4).

4. Publish and hand off (same run as step 3)
   - Apply **Required cleanup before sending** from `TEMPLATE.md` (strip plan YAML frontmatter; PRD markdown only).
   - Read `LINEAR-MCP.md`.
   - Use Linear MCP only when it is available in the current agent runtime.
   - Read the relevant MCP/tool descriptors before any MCP call.
   - When a requirement parent applies (direct requirement intake **or** Write PRD sub-task resolved to parent), run `LINEAR-MCP.md` step 5 idempotency **before** creating issues. When an implementation child already exists, comment on the Write PRD sub-task if intake was one; otherwise comment on the requirement issue — then stop.
   - Create an **implementation** issue in `Sokosumi`, state `Todo`, with exactly one label — **without** `delegate` on create.
   - Set `parentId` to the requirement issue when a requirement parent applies.
   - Add `[repo=masumi-network/sokosumi]` near the top of the description (unless user overrides repo).
   - Create a **confirm PRD** sub-task (child of the implementation issue). Non-blocking — see `LINEAR-MCP.md`.
   - Create a **verify implementation** sub-task (child of the implementation issue). Reviewer runs after PR — see `PRD-REVIEWER.md` and `LINEAR-MCP.md`.
   - When `handoffToCursor` is true (default unless user opts out): hand off with **one** trigger per `LINEAR-MCP.md` — default is `delegate: "Cursor"` via `save_issue` with `id` **after** both sub-tasks exist; do **not** also post `@Cursor` on the same issue. Manual fallback: `@Cursor` comment only when MCP `delegate` is unavailable.
   - Comment on the requirement issue linking the implementation issue when both exist.
   - Return implementation issue id/URL, confirm sub-task id/URL, verify sub-task id/URL, label, delegate status, and parent link.
   - If the current agent cannot access Linear MCP, stop and say what must be reloaded or configured. Do not use browser automation or raw API fallback.

## Writing style

- Be straight to the point.
- Lead with the goal in one or two sentences.
- Prefer bullets and small tables over paragraphs.
- Cite real file paths as markdown links.
- Avoid filler, caveats, and speculative options.
- Do not over-preserve compatibility for unshipped branch work.
- Keep out-of-scope explicit.

## Label classification

Pick one label. Do not ask unless genuinely ambiguous.

| Label | Use when |
|-------|----------|
| `Feature` | New user-facing capability, new route/page/API, greenfield integration, net-new product behavior |
| `Bug` | Broken or incorrect existing behavior, regression, crash, wrong data, failed auth/permission that should work |
| `Improvement` | Enhancement to something that already works: UX polish, performance, refactor, DX, accessibility, small behavior tweak |

Decision order:

1. User says "bug", "broken", "fix", or "regression" -> `Bug`.
2. User says "improve", "polish", "optimize", or "refactor" and no new capability is added -> `Improvement`.
3. The spec delivers a new capability users did not have -> `Feature`.
4. The spec only changes an existing flow -> `Improvement`.
5. If unclear, default to `Feature` for greenfield spec work and `Improvement` for iteration on shipped code.

Align title prefix with label when helpful:

| Prefix | Label |
|--------|-------|
| `feat` | `Feature` |
| `fix` | `Bug` |
| `refactor`, `perf`, `style`, `test`, `docs`, `chore` | `Improvement` |

## Mermaid rules

- Use `flowchart TB` for data flow unless LR is clearer.
- Use camelCase node IDs with no spaces.
- Put labels with spaces inside quotes, for example `CoreAPI["Core API"]`.
- Wrap edge labels that contain punctuation in quotes.
- Do not use custom colors, `style`, `classDef`, or `click`.

## Gold-standard references

- `file:///Users/francisluz/.cursor/plans/sok-453_design.md_60b4734c.plan.md` - external API, shared UI, task auto-attach, subagent blocks.
- `file:///Users/francisluz/.cursor/plans/sok-537_history_view_f2a6e4c8.plan.md` - current/target architecture, DB read model, API/UI split, subagent blocks.
- `file:///Users/francisluz/.cursor/plans/hermes_review_subagents_ea042514.plan.md` - file ownership table and conflict-safe subagent split.

## Supporting files

- Use `WORKFLOW.md` for requirement vs implementation issue types and the coding-agent handoff.
- Use `REQUIREMENT-TEMPLATE.md` when writing or reviewing high-level requirement issues.
- Use `TEMPLATE.md` for the implementation PRD skeleton.
- Use `SUBAGENT-RUBRIC.md` before adding current/target architecture or subagent workstreams.
- Use `LINEAR-MCP.md` when publishing the implementation issue and sub-tasks.
- Use `PRD-REVIEWER.md` for the post-implementation reviewer `/goal` loop.
- Use `CURSOR-AUTOMATION.md` for optional Linear-triggered Cloud Agent setup.
