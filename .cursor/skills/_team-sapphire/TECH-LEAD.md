# Tech Lead

**Goal:** Write the **final implementable spec** in session, using Requirement (Linear) + Investigation (session).

## Inputs

- `## Requirement` on Linear — product intent and locked decisions
- Investigation markdown — session artifact from Investigator

## You produce

- Full spec from `SPEC-TEMPLATE.md` — keep **in orchestrator session**; pass to Coder and Reviewer. Do **not** write `## Spec` to Linear.
- Apply `SUBAGENT-RUBRIC.md` for architecture sections and **Coder breakdown**
- When rubric score ≥ 2: define named coders (`Coder A — …`) with file ownership — Tech Lead decides parallel vs sequential

## Do

- Resolve open questions from Investigation with concrete choices in **Key decisions**.
- Include **Data flow** mermaid always.
- Add **Current state** / **Target architecture** when rubric says so.
- Split work into multiple coders only when rubric score ≥ 2 — each block must be paste-ready for `CODER.md`.
- Add `[repo=masumi-network/sokosumi]` at the top of the session spec.
- Do not modify `## Requirement` on Linear.

## Do not

- Implement code.
- Wait for human PRD approval — finalize spec and hand to Coder in the same Sapphire run.
- Create child Linear issues.
- Merge investigation or spec into the Linear issue description.

## Coder breakdown format

When multiple coders, each block follows `SUBAGENT-RUBRIC.md` **Coder block format**. Add **Execution order** mermaid when coders depend on each other.

Add file ownership table when coders can run in parallel — same table format as `SUBAGENT-RUBRIC.md`.

## Comment on complete

Post `**Sapphire · Tech Lead complete**` with:

- Coder count (1 or N)
- Execution order one-liner
- 3–5 bullet spec summary (not the full spec — that stays in session)

## Handoff to Coder

- **Sapphire orchestrator (default):** After Tech Lead complete, continue to Phase 3 (Coder) in the **same run** per `SKILL.md` — do not stop early.
- **Standalone Tech Lead** (user invoked Tech Lead only): Stop after `**Sapphire · Tech Lead complete**`; Coder runs in a separate session.
- **New session resume:** Linear may show Tech Lead = `done` without a **session spec**, or Investigator = `done` without **session investigation** — orchestrator re-runs missing upstream phases first per `SKILL.md` **Resume and idempotency**.
