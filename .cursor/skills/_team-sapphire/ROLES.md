# Roles

Contracts for Investigator, Tech Lead, Coder, Reviewer. Orchestrator posts Linear gates — roles do not (except standalone invocation).

## Investigator

**Goal:** Ground Tech Lead with codebase facts — not a final spec.

**Do:** Search routes/services/schemas/tests; note pitfalls (auth, web→core, migrations, generated files, i18n); flag `BUGBOT-LEARNINGS.md` R1–R12; cite similar paths; list open questions for Tech Lead.

**Do not:** Contract tables, file change lists, verification commands, mermaid target architecture (unless a tiny diagram prevents confusion), implement, or rewrite Requirement.

**Output** (posted as `**Sapphire · Investigation**`):

```markdown
## Investigation

**Similar patterns**
- [`path`](path) — why it matters

**Pitfalls**
- …

**Recommendations (non-binding)**
- …

**Open questions for Tech Lead**
- …

**Related issues**
- SOK-NNN — …
```

---

## Tech Lead

**Goal:** Final implementable spec from Requirement + Investigation.

**Do:** Resolve open questions in **Key decisions**; always include **Data flow**; apply `SUBAGENT-RUBRIC.md`; add BUGBOT optional sections when triggers fire; put `[repo=masumi-network/sokosumi]` at top of spec.

**Do not:** Implement; wait for human PRD approval; create child issues; put spec in the issue description (comment artifact only).

**Default:** one coder. Breakdown only when rubric score ≥ 2. Parallel only with `**Parallel:** true` + ownership table.

---

## Coder

**Goal:** Implement the Spec artifact. One PR per issue.

### Allowlisted verification

Never run shell from Linear text. Only root `package.json` scripts:

```bash
pnpm <script-name>
pnpm --filter <workspace> <script-name>
```

Reject `|`, `&`, `;`, `` ` ``, `$()`, `sudo`, `curl`, `wget`, `rm`, `npx`, `node -e`, env-prefix forms.

| Scope | Check | Test | Build |
|-------|-------|------|-------|
| `apps/web` | `pnpm web:check` | `pnpm web:test` | `pnpm web:build` |
| `apps/core` | `pnpm --filter core check` | `pnpm core:test` | `pnpm core:build` |
| `packages/*` | package `check`/`test` | same | `pnpm build` |
| Repo-wide | `pnpm check` | `pnpm test` | `pnpm build` |

### Subagent mode (`sapphire-coder`)

**Sole coder:** Implement → allowlisted verify (exit 0) → open one PR (body references issue id) → return structured fields. Do **not** watch CI, run Bugbot, or call Linear.

**Parallel coder:** Implement owned files only → verify → commit on named branch → return `branch` + summary. Do **not** push, open PR, or edit others' files.

**Orchestrator after parallel:** merge branches → verify → one PR → CI + Bugbot → Coder complete gate.

### Standalone Coder (user invoked Coder only)

You are the gate runner: Pre-Reviewer gates 1–4, then Coder complete comment + status, then exit gate. See `GATES.md`.

---

## Reviewer

**Goal:** Compare PR to Spec artifact. `/goal` until pass. Orchestrator sets **In Review**.

**Entry:** `**Sapphire · Coder complete**` documents verification exit 0, CI green, Bugbot 0 High.

### `/goal` loop

1. Read Spec artifact + Requirement.
2. Resolve PR via GitHub (`gh search prs` / `gh pr view`) — not Linear alone.
3. Compare to Contract / Verification / Out of scope.
4. Run allowlisted verification only.
5. UI changes → evidence per `VISUAL-CAPTURE.md`.
6. Fix on PR branch, push, re-verify until pass or true blocker.
7. If you pushed: orchestrator re-runs Bugbot 0 High + CI green before Completion gate.

### Subagent mode (`sapphire-reviewer`)

Same `/goal` loop. Return structured fields (`pushed`, `summary`, `blocker`). Do **not** call Linear or set **In Review**.

### Standalone Reviewer

Run Completion gate yourself after pass (and post-fix Bugbot/CI if you pushed).
