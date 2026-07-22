# Phase — Coder

Load in **Phase 3** (and standalone Coder). Do **not** load during Investigator / Tech Lead.

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

**Verify set:** package roots from Spec **Deliverables** paths ∪ workspaces the coder actually edited. Map path → `apps/web` | `apps/core` | `packages/<name>`. Deduplicate. Monorepo-tooling-only edits → Repo-wide scripts.

**Must pass (exit 0):** check + test for every workspace in the verify set.

**Build:** only if Spec Verification lists a build script for that scope.

**Local verify** = same check+test set (and listed builds). After **one** Spec-aligned fix→re-verify failure → unrecoverable blocker (`SKILL.md`).

## Branch checkout

Prompt always includes branch name (orchestrator sets per `SKILL.md`).

- **Sole / missing local:** `git fetch origin main` then `git checkout -b <branch> origin/main`
- **Sequential:** `git fetch origin`; if `origin/<branch>` exists → checkout + `git pull --ff-only`; else create from `origin/main`

## Modes (`sapphire-coder`)

**Sole (`mode: sole`):** Implement → allowlisted verify → open **one draft PR** → push → return. Do **not** watch CI, run Reviewer, or call Linear.

**PR:** draft unless user asked ready-for-review. **Title** = primary commit subject verbatim (Conventional Commit). **Body:** Linear issue link + Spec summary ≤8 lines.

**Sequential (`mode: sequential`):** Owned block only → verify → commit → **push** → `prUrl` empty, `pushed: true`. Do **not** open a PR.

**Orchestrator after sequential:** After last `ok`, open the **one draft PR** (title/body rules above), then **CI green**, then Phase 4 Reviewer.

**Return keys:** `ok`, `prUrl`, `branch`, `verification`, `pushed`, `summary` (one line), `blocker`. `pushed: true` = remote push done.

## Standalone Coder

Verify → draft PR → **CI green** (`SKILL.md`) → hand off to Reviewer (`PHASE-REVIEWER.md`) unless user asked Coder-only. Linear only per `LINEAR.md`.
