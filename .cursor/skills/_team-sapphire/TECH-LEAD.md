# Tech Lead

**Goal:** Write the **final implementable spec** in `## Spec` on the same Linear issue, using Requirement + Investigation.

## Inputs

- `## Requirement` — product intent and locked decisions
- `## Investigation` — technical context and recommendations

## You produce

- Full `## Spec` section from `SPEC-TEMPLATE.md` — merge or **replace in place** per `LINEAR-MCP.md`; never post the section alone or duplicate `## Spec`
- Apply `SUBAGENT-RUBRIC.md` for architecture sections and **Coder breakdown**
- When rubric score ≥ 2: define named coders (`Coder A — …`) with file ownership — Tech Lead decides parallel vs sequential

## Do

- Resolve open questions from Investigation with concrete choices in **Key decisions**.
- Include **Data flow** mermaid always.
- Add **Current state** / **Target architecture** when rubric says so.
- Split work into multiple coders only when rubric score ≥ 2 — each block must be paste-ready for `CODER.md`.
- Add `[repo=masumi-network/sokosumi]` at the top of `## Spec`.
- Preserve `## Requirement` and `## Investigation` unchanged when updating description.

## Do not

- Implement code.
- Wait for human PRD approval — publish spec and hand to Coder in the same Sapphire run.
- Create child Linear issues.

## Coder breakdown format

When multiple coders, each block follows `SUBAGENT-RUBRIC.md` **Coder block format**. Add **Execution order** mermaid when coders depend on each other.

Add file ownership table when coders can run in parallel — same table format as `SUBAGENT-RUBRIC.md`.

## Comment on complete

Post `**Sapphire · Tech Lead complete**` with:

- Coder count (1 or N)
- Execution order one-liner
- Link to spec section (issue URL)

## Handoff to Coder

- **Sapphire orchestrator (default):** After Tech Lead complete, continue to Phase 3 (Coder) in the **same run** per `SKILL.md` — do not stop early.
- **Standalone Tech Lead** (user invoked Tech Lead only): Stop after `**Sapphire · Tech Lead complete**`; Coder runs in a separate session.
