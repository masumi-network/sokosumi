---
name: feature-spec
description: Draft concise Sokosumi feature PRDs and Linear-ready specs. Use when the user asks to write a PRD, feature spec, Linear task, architecture spec, implementation plan, subagent plan, or SOK feature request.
disable-model-invocation: true
---

# Feature Spec

Create a concise, Linear-ready PRD for Sokosumi features. The spec should be useful to an implementer, not a strategy memo.

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

1. Intake
   - Required: feature summary.
   - Optional: priority, milestone, assignee, blockers, locked decisions, label override, project override.
   - If the feature summary is missing, ask one question and wait.

2. Discovery
   - Search the relevant app/package areas before drafting.
   - Read nearby `AGENTS.md` files when the feature clearly touches a scoped area.
   - Find similar routes, services, schemas, actions, UI, migrations, or tests.
   - If Linear MCP is healthy, search related Linear issues and link blockers/dependencies.
   - Keep notes short. Use bullets. Do not write a research report.

3. Draft the PRD
   - Fill `TEMPLATE.md`.
   - Always include a `Data flow` mermaid diagram.
   - Include `Current state` and `Target architecture` only when the rubric in `SUBAGENT-RUBRIC.md` says to.
   - Split into subagent workstreams only when the rubric in `SUBAGENT-RUBRIC.md` says to.
   - Infer the Linear label and show it near the top:

     ```markdown
     **Linear:** project Sokosumi - state Todo - label Feature
     ```

   - End with: `Approve this spec?`
   - Do not create or update Linear until the user approves the spec.

4. After approval
   - Read `LINEAR-MCP.md`.
   - Use the user-linear MCP only.
   - Read the relevant MCP tool descriptors before any MCP call.
   - Create the Linear issue in `Sokosumi`, state `Todo`, with exactly one label.
   - Return the issue identifier, URL, and applied label.

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

- Use `TEMPLATE.md` for the PRD skeleton.
- Use `SUBAGENT-RUBRIC.md` before adding current/target architecture or subagent workstreams.
- Use `LINEAR-MCP.md` only after the user approves the PRD.
