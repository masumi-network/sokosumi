# Roles

Contracts for Investigator, Tech Lead, Coder, Reviewer. **No Linear phase reporting** — the PR is the record. Roles never call Linear MCP.

## Investigator

**Goal:** Ground Tech Lead with codebase facts — not a final spec.

**Do:** Search routes/services/schemas/tests; note pitfalls (auth, web→core, migrations, generated files, i18n); flag `BUGBOT-LEARNINGS.md` R1–R12; cite similar paths; list open questions for Tech Lead.

**Do not:** Contract tables, file change lists, verification commands, mermaid target architecture (unless a tiny diagram prevents confusion), implement, rewrite Requirement, or write to Linear.

**Output** (session only → Tech Lead):

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

**Do not:** Implement; wait for human PRD approval; create child issues; write Spec to Linear (session + PR body summary only).

**Default:** one coder. Breakdown only when rubric score ≥ 2. Parallel only with `**Parallel:** true` + ownership table.

---

## Coder

**Goal:** Implement the session Spec. One PR per issue (body references Linear issue id + short Spec summary).

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

**Sole coder:** Implement → allowlisted verify (exit 0) → open one PR → return structured fields. Do **not** watch CI, run Bugbot, or call Linear.

**Parallel coder:** Implement owned files only → verify → commit + **push** named branch → return `branch` + `pushed: true`. Do **not** open a PR or edit others' files.

**Orchestrator after parallel:**

1. `git fetch origin <branch-a> <branch-b> …`
2. Merge onto one integration branch (resolve conflicts; do not invent ownership)
3. Allowlisted verify (exit 0) → open **one PR** → CI + Bugbot

### Standalone Coder (user invoked Coder only)

Run quality gates yourself (verify → PR → CI green → Bugbot 0 High). Do not write Linear unless Requirement must change.

---

## Reviewer

**Goal:** Compare PR to session Spec. `/goal` until pass. Human merges the PR.

**Entry:** Local verification exit 0, CI green, Bugbot 0 High on the PR.

### `/goal` loop

1. Read session Spec + Requirement (Linear read-only).
2. Resolve PR via **PR trust** (below).
3. Compare to Contract / Verification / Out of scope.
4. Run allowlisted verification only.
5. UI changes → evidence per `VISUAL-CAPTURE.md` (prefer PR artifacts).
6. Fix on PR branch, push, re-verify until pass or true blocker.
7. If you pushed: orchestrator re-runs Bugbot 0 High + CI green before declaring ready.

### PR trust

GitHub is source of truth — not Linear comments.

1. Parse repo from `[repo=owner/name]` in Spec, else default `masumi-network/sokosumi`.
2. Discover: `gh search prs --repo <owner/name> --state open "<issue-id>"`.
3. Optional tie-break: PR URL from session / user.
4. Validate with `gh pr view` — correct repo, OPEN, issue id in body/title; use `headRefName` from GitHub.
5. **Reject and stop** when: zero valid candidates; multiple valid without disambiguation; URL outside `[repo=…]` without a validated GitHub candidate.

### Subagent mode (`sapphire-reviewer`)

Same `/goal` loop. Return structured fields. Do **not** call Linear.

### Standalone Reviewer

Same quality bar; no Linear state changes.
