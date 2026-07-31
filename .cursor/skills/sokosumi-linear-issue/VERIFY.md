# Verify

Load during **Implement** (and CI fix). Do not load during Investigate / Spec. Do not load `SEQUENTIAL.md` (orchestrator only).

## Allowlisted verification

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

**Verify set:** package roots from Spec **Deliverables** paths ∪ workspaces actually edited. Map path → `apps/web` | `apps/core` | `packages/<name>`. Deduplicate. Monorepo-tooling-only edits → Repo-wide scripts.

**Must pass (exit 0):** check + test for every workspace in the verify set.

**Build:** only if Spec Verification lists a build script for that scope.

**Local verify** = same check+test set (and listed builds). After **one** Spec-aligned fix→re-verify failure → unrecoverable blocker (`SKILL.md`).

### Evidence before `ok`

No completion claim without fresh evidence this turn:

1. Run the full allowlisted verify commands for the verify set.
2. Read exit codes and failure output.
3. Only then set `ok: true` / claim pass.

Prior runs, “should pass”, or partial checks do not count.

### Verify / CI fail - root cause first

Inside the fix budget (local: one re-verify; CI: ≤3 fix+push per `SKILL.md`):

1. Read the error / log fully.
2. Isolate: workspace + failing script or test name from the output.
3. Write root cause in `summary` (one line, prefix `root:`) **before** editing. If stopping: same text in `blocker`.
4. Apply one minimal Spec-aligned fix aimed at that root cause.

No shotgun patches across unrelated files. No fix without a `root:` line in `summary`/`blocker`.

## TDD (required vs skip)

**Owner of these globs - do not restate elsewhere.** Decide from Spec **Deliverables** paths only.

**TDD required** when ≥1 Deliverable matches:

- `apps/core/**`
- `packages/database/**`
- `packages/*/src/**`

**TDD skip** when every Deliverable is outside those globs (e.g. web UI/CSS only, `apps/web/messages/**`, `docs/**`, `*.md` only).

When **TDD required**:

1. Spec Verification **must** list the allowlisted test command that proves the Contract.
2. Implementer **must** add or update a failing test first, see it fail, then minimal code to pass, then full verify set.
3. Missing required test before implement → Spec gap; do not claim `ok: true`.

When **TDD skip**: do not invent tests for copy/CSS/docs/i18n-only work.

## Branch checkout

Prompt always includes branch name (orchestrator sets per `SKILL.md`).

- **Sole / missing local:** `git fetch origin main` then `git checkout -b <branch> origin/main`
- **Sequential:** `git fetch origin`; if `origin/<branch>` exists → checkout + `git pull --ff-only`; else create from `origin/main`

## Modes (`poteto-agent`)

**Sole:** Implement → allowlisted verify (evidence before `ok`) → open **one draft PR** → push → return. Do **not** watch CI, run Review, or call Linear.

**PR:** draft unless user asked ready-for-review. **Title** = primary commit subject verbatim (Conventional Commit). **Body:** Linear issue link + Spec summary ≤8 lines.

**Sequential:** Owned block only → verify → commit → **push** → `prUrl` empty, `pushed: true`. Do **not** open a PR. Orchestrator runs light Spec check via `SEQUENTIAL.md` between blocks.

**Return keys:** `ok`, `prUrl`, `branch`, `verification`, `pushed`, `summary` (one line), `blocker`. `pushed: true` = remote push done. On verify/CI fail: `summary` must start with `root:`.
