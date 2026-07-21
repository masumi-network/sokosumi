# Roles

Contracts for Investigator, Tech Lead, Coder, Reviewer. **No Linear phase reporting** — PR is the record. Roles never call Linear MCP.

## Token shape (all roles)

- Caveman **full** in chat. **Not ultra** on Spec — ambiguity costs more than articles.
- Prefer `path:line` + short clause. Cap lists. State each fact once.
- Auto-clarity for security, irreversible confirms, fragment ambiguity.

## Investigator

**Goal:** Codebase facts for Tech Lead — not a final Spec.

**Do:** Search routes/services/schemas/tests; pitfalls (auth, web→core, migrations, generated files, i18n); flag `BUGBOT-LEARNINGS.md` R1–R12; similar paths; open questions. Prefer `cavecrew-investigator` for locate-only scouts.

**Do not:** Contract tables, file-change lists, verification commands, target mermaid (unless tiny diagram prevents confusion), implement, rewrite Requirement, write Linear. Do not load `SPEC-TEMPLATE.md`, `SUBAGENT-RUBRIC.md`, or `VISUAL-CAPTURE.md`.

**Caps:** ≤12 patterns · ≤8 pitfalls · ≤5 recommend · ≤8 open · ≤5 related. ≤15 words after path/id per bullet.

**Output** (session → Tech Lead):

```markdown
## Investigation

**Patterns**
- `path:line` — `symbol` — why it matters

**Pitfalls**
- `path:line` — risk (Rn if trigger matches)

**Recommend** (optional)
- …

**Open** (Tech Lead must resolve)
- …

**Related**
- SOK-NNN — …
```

Omit empty sections. No essay preamble.

---

## Tech Lead

**Goal:** Implementable Spec from Requirement + Investigation.

**Do:** Resolve opens in **Key decisions**; always **Data flow**; `SUBAGENT-RUBRIC.md`; BUGBOT optional sections when triggers fire; `[repo=masumi-network/sokosumi]` at top. List ≥1 path-only route under Verification **iff** Spec deliverables include `apps/web` page/layout/component files (not only generated Core client under `src/lib/clients/`). That list defines **UI in scope**.

**Do not:** Implement; wait for human PRD approval; child issues; Spec on Linear. Do not load `VISUAL-CAPTURE.md`.

**Default:** one coder. Breakdown only when rubric ≥ 2 — **sequential** on one branch, Tasks one-at-a-time in Execution order. No parallel coder branches.

**Spec size caps:**

| Field | Max |
|-------|-----|
| Problem / Goal | 2 sentences each |
| Confirmed decisions | 8 bullets |
| Contract rows | 8 |
| Key decisions rows | 10 |
| Coder Context | 5 bullets each |
| Out of scope | 8 bullets |
| PR Spec summary | 8 lines |
| Prose outside tables/lists | Forbidden |

Keep Data flow + Verification + Out of scope. Smallest useful mermaid.

---

## Coder

**Goal:** Implement Spec. One PR (issue id + Spec summary ≤8 lines).

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
| `packages/<name>` | `pnpm --filter <name> check` | `pnpm --filter <name> test` | `pnpm --filter <name> build` |
| Repo-wide | `pnpm check` | `pnpm test` | `pnpm build` |

**Must pass (exit 0):** for every workspace in the **verify set**, run that scope’s **check** and **test**.

**Verify set:** package roots from Spec **Deliverables** paths, **plus** any workspace the coder actually edited. Map path → workspace (`apps/web`, `apps/core`, `packages/<name>`). Deduplicate. If edits span the whole monorepo tooling only, use Repo-wide scripts.

**Build:** run only when Spec Verification lists a build script for that scope.

**Local verify** (Reviewer entry / Coder handoff) = the same check+test set (and listed builds).

### Subagent mode (`sapphire-coder`)

**Sole (`mode: sole`):** Prompt includes branch name. If local branch missing, create it from up-to-date `main` (`git fetch origin main` then `git checkout -b <branch> origin/main`). Implement → allowlisted verify → **open one PR** → push → return. Do **not** watch CI, run Bugbot, or call Linear.

**Sequential (`mode: sequential`):** Prompt includes shared branch name. If local branch missing, create/check out from `origin/<branch>` if it exists on remote, else from `origin/main`. Implement owned block only → verify → commit → **push that branch** → return with `prUrl` empty and `pushed: true`. Do **not** open a PR.

**Orchestrator after sequential chain:** After the last coder returns `ok`, open the **one PR** from the shared branch (issue id + Spec summary ≤8 lines), then CI + Bugbot.

**Return keys:** `ok`, `prUrl`, `branch`, `verification`, `pushed`, `summary` (one line), `blocker`.

### Standalone Coder

Gates yourself (verify → PR → **CI green** per `SKILL.md` → Bugbot 0 High). No Linear unless Requirement must change.

---

## Reviewer

**Goal:** PR vs Spec. `/goal` until pass. Human merges.

**`/goal`:** Loop until the PR matches Spec (Contract / Verification / Out of scope), allowlisted verify exits 0, and UI evidence exists when **UI in scope** — or stop on a true blocker.

**UI in scope:** Spec Verification lists ≥1 path-only route. If none, skip visuals. Do **not** spawn `sapphire-reviewer` unless the user asks (Reviewer stays on orchestrator by default).

**Entry:** Local verify exit 0, **CI green** (see `SKILL.md`), Bugbot 0 High.

### `/goal` loop

1. Session Spec + Requirement (Linear read-only).
2. **PR trust** (below).
3. Compare Contract / Verification / Out of scope.
4. Allowlisted verify only (check+test; builds if listed).
5. UI in scope → `VISUAL-CAPTURE.md`. Else skip visuals.
6. Fix on PR branch; push; re-verify until pass or blocker.
7. If pushed: orchestrator re-runs Bugbot 0 High + CI green.

### PR trust

1. Repo from `[repo=owner/name]` in Spec, else `masumi-network/sokosumi`.
2. `gh search prs --repo <owner/name> --state open "<issue-id>"`.
3. Optional: PR URL from session / user.
4. `gh pr view` — OPEN, issue id in body/title; use `headRefName`.
5. **Stop** if zero/ambiguous candidates or unvalidated foreign URL.

### Subagent / standalone

Structured return only. No Linear state changes.
