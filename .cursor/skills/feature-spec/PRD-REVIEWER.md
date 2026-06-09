# PRD Reviewer Subagent

Post-implementation reviewer. Runs **after** the coding agent opens a PR and sets the parent implementation issue to **In Review**.

Compares **code + PR** against the parent PRD. Loops with **`/goal`** until every criterion passes. Blocks human merge until the review sub-task is **Done**.

## When it runs

| Trigger | Who |
|---------|-----|
| Parent implementation issue → `In Review` | Coding agent (required handoff step) |
| Review sub-task started | Coding agent — `delegate: "Cursor"` **or** `@Cursor` + `/goal` comment, not both |
| Reviewer agent starts | Cursor Cloud Agent on the review sub-task |

The spec agent creates the review sub-task at publish time. It stays idle until the coding agent triggers it.

## `/goal` loop

`/goal` is the team convention for **run until done**. Prefix the reviewer handoff with `/goal` and list **verifiable** completion criteria.

The reviewer must **not** stop after one pass. Loop until all criteria pass or a true blocker needs a human:

1. Read parent implementation issue (full PRD).
2. Read requirement issue when `**Requirement:** SOK-XXX` is present.
3. Compare PR diff and changed files to PRD **Contract / behavior**, **Verification**, and **Out of scope**.
4. Run verification commands from the PRD (defaults below when unspecified).
5. For user-facing UI: capture screenshot or short screen recording.
6. If anything fails: fix on the PR branch, push, rerun checks, repeat from step 3.
7. Only when all pass: attach evidence, mark review sub-task **Done**, comment on parent.

### Default verification commands

Use PRD **Verification** when present. Otherwise infer scope from touched paths:

| Scope | Lint/check | Test | Build |
|-------|------------|------|-------|
| `apps/web` | `pnpm web:check` | `pnpm web:test` | `pnpm web:build` |
| `apps/core` | `pnpm --filter core check` | `pnpm core:test` | `pnpm core:build` |
| `packages/*` | filter package `check` / `test` | same | `pnpm build` at root if shared |
| Repo-wide / unclear | `pnpm check` | `pnpm test` | `pnpm build` |

Run the **narrowest** command set that covers all deliverables in the PRD.

### Stop conditions

| Outcome | Action |
|---------|--------|
| All criteria pass | Mark review sub-task **Done**; comment on parent with checklist + links |
| Fixable failure | Fix, push, rerun — continue `/goal` loop |
| Blocker (missing env, product decision, external dependency) | Comment on parent with blocker; leave review sub-task **In Progress**; do not mark Done |
| Max iterations (optional team cap, e.g. 10) | Comment failure summary on parent; escalate to human |

For unattended Cloud Agent runs, prefer a **stop hook** that injects `followup_message` when verification fails. See [Cursor agent best practices — long-running loops](https://cursor.com/blog/agent-best-practices).

## Review checklist

Every review run must explicitly check:

### PRD vs code

- [ ] **Goal** and **Problem** match what the PR delivers
- [ ] **Contract / behavior** table rows are implemented (input, output, auth, errors)
- [ ] **Key decisions** honored
- [ ] **Out of scope** items were not added
- [ ] Deliverable file paths from PRD exist and changed as expected
- [ ] Requirement parent intent respected when `**Requirement:**` is set

### Quality gates

- [ ] `pnpm check` (or scoped equivalent) — exit 0
- [ ] `pnpm test` (or scoped equivalent) — exit 0
- [ ] `pnpm build` (or scoped equivalent) — exit 0

### Visual evidence (user-facing changes)

- [ ] Screenshot or screen recording attached when the PRD touches UI, routes, or UX
- [ ] Evidence shows the **happy path** from the PRD goal
- [ ] Light and dark mode when the PRD or changed components require theme support
- [ ] Empty/loading/error states when specified in the PRD

Skip visual evidence only for backend-only, docs-only, or test-only PRDs with no UI surface.

## Visual capture

Use **agent-browser** (`.agents/skills/agent-browser/SKILL.md`) or Playwright when the dev server is running.

```bash
# Example: local web dev
pnpm web:dev   # separate process
agent-browser open http://localhost:3000/<route-from-PRD>
agent-browser wait --load networkidle
agent-browser screenshot --full
```

Attach files to:

1. Linear comment on the **review sub-task** (primary)
2. GitHub PR comment (secondary, link from Linear)

Prefer **screenshot** for static UI; **short screen recording** for flows (navigation, forms, animations).

## Linear sub-task shape

Created by spec agent — see `LINEAR-MCP.md` step 8.

| Field | Value |
|-------|--------|
| Title | `chore(review): verify implementation against PRD` |
| Parent | Implementation issue |
| State | `Todo` |
| Label | `Improvement` |
| Delegate | **None** until coding agent handoff |

## Coding agent handoff (required)

When the coding agent sets the parent to **In Review**, it must start the reviewer on the review sub-task with **one** trigger — `delegate: "Cursor"` via Linear MCP **or** the `@Cursor` comment below, not both.

**Manual / comment-only path:**

```markdown
@Cursor

/goal Verify implementation against PRD on parent SOK-XXX until every criterion passes.

**Parent PRD:** SOK-XXX (implementation issue — read description)
**PR:** <url>
**Branch:** <branch>

**Done when:**
1. Code matches PRD Contract/behavior, Verification, and Out of scope
2. Lint/check passes (use PRD Verification commands)
3. Tests pass
4. Build passes
5. Screenshot or screen recording attached for user-facing changes

Loop: fix failures on the PR branch, push, rerun all checks. Do not mark this sub-task Done until all pass.
On pass: mark this sub-task Done and comment on parent SOK-XXX with evidence links.
Do not mark parent Done.
```

**Default (MCP):** `save_issue` on the review sub-task with `delegate: "Cursor"` and a comment **without** `@Cursor` that includes the same `/goal` body (PR URL, branch, criteria). Do not also post the `@Cursor` block above.

Replace `SOK-XXX` with the implementation issue identifier.

## Reviewer completion

When all criteria pass:

1. `save_comment` on review sub-task — checklist, command output summary, screenshot/recording links
2. `save_comment` on parent implementation issue — "Review passed" + links to evidence and PR
3. `save_issue` on review sub-task — `state: "Done"`
4. Leave parent in **In Review** for human PR merge

## Failure comment template

```markdown
**Review failed** — continuing `/goal` loop.

**PRD gaps:**
- ...

**Failed checks:**
- `pnpm web:check` — ...
- `pnpm web:test` — ...

**Next:** fix on branch `<branch>`, push, rerun.
```

## What not to do

- Do not mark parent **Done** — human merges the PR
- Do not mark review **Done** without passing lint, test, and build
- Do not skip visual evidence for UI PRDs
- Do not stop after a single failed verification run when fixes are possible
- Do not expand scope beyond the PRD to "make review pass"
