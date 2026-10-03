# Core leftover-surface code-quality audit (research only)

Date: 2026-10-03  
Scope: `apps/core` after excluding `src/helpers`, `src/lib`, `src/routes`, `src/services`, `src/clients`, `src/middleware`, `src/schemas`, and vendor `.agents/skills`.

Covered: `src/soko-bot-runner`, `src/config`, `src/types`, `src/test`, `src/test-fixtures`, `src/index.ts` (+ `index.test.ts`), `scripts/`, `fixtures/`, `package.json` scripts.

Hard skips (left alone, not ranked): #4390 oauth shim revert hold, #5667, namefully, `onInvalidPreviousResponseId`, vendor `.agents/skills`, #5636 notification JSON helper (`helpers/notification-row-json*`).

Lenses: (1) Core `AGENTS.md` platform practice, (2) dead/killable, (3) needless complexity, (4) unnecessary comments.

Cross-repo unused checks used whole-repo `rg` (not Core-only).

---

## Ranked findings

Prefer real deletions. Size: S ≤ ~50 LOC / one file, M multi-file or ~50–300 LOC, L structural / 300+ LOC.

### 1. Kill dead lab-quiet Composio fixtures — **kill / S**

- **Paths:** `apps/core/fixtures/soko-bot-lab-quiet/GMAIL_FETCH_EMAILS.empty.json`, `…/GOOGLECALENDAR_EVENTS_LIST.empty.json` (and the empty parent dir)
- **Why:** Zero references outside the two files. Notes claim use by `quiet-standup` / `quiet-delta`, but:
  - Lab seam default dir is `fixtures/soko-bot-integrations` (`soko-bot-integrations.service.ts` `fixtureDir()`), not `soko-bot-lab-quiet`
  - Filenames are `*.empty.json`; replay looks for ``${slug}.${hash}.json`` (or any `${slug}.*` sibling)
  - `soko-bot-lab.mts` never sets `SOKO_BOT_INTEGRATION_FIXTURE_DIR` to this folder
  - No `fixtures/soko-bot-integrations/` tree is committed either
- **Action:** Delete the directory. If quiet scenarios need empty inbox/calendar under `--replay`, record real fixtures into `fixtures/soko-bot-integrations/` with the hash naming (out of this leftover-surface kill).
- **Lens:** dead/killable

### 2. Stale / noise comments in `src/index.ts` — **trim / S**

- **Path:** `apps/core/src/index.ts`
- **Why:**
  - `// Main app is exported at the end…` is false: nothing exports `mainApp`; `serve()` owns it
  - `// Markdown documentation` restates the next block
  - `/llms.txt` JSDoc Q&A (`Q: Why /llms.txt?`) is longer than the route
  - `// Mount OpenAPI router at root - THIS IS IMPORTANT SO YOU CAN HAVE BOTH` is incomplete noise; next line already explains `robots.txt` vs maintenance
- **Keep:** sentry middleware ordering comment; webhook / image-studio-agent mount reasons (they document non-obvious auth boundaries)
- **Lens:** unnecessary comments

### 3. Essay JSDoc on `FILES_JEV_ENABLED` — **trim / S–M**

- **Path:** `apps/core/src/config/env.ts` (~lines 152–182)
- **Why:** ~30 lines of product history and token-accounting narrative on one Zod key. Useful bits (default on, daily spend caps, disable = deterministic rank) fit in 3–5 lines. Rest belongs in ADR / Files docs if kept at all.
- **Action:** Trim to current policy + pointer to `lib/files/jev-scheduler.ts` / spend controls. Do not delete the key.
- **Lens:** unnecessary comments (also mild complexity-as-prose)

### 4. Redundant constants commentary — **trim / S**

- **Path:** `apps/core/src/config/constants.ts`
- **Why:** Section banners (`Time durations in seconds`, `Rate limits…`) plus `/** One day in milliseconds. */` on `DAY_MS` add no decision value. Long comments that justify *numbers* (chat burst/refill, session fresh age, image-studio caps) are fine — keep those.
- **Action:** Drop section banners and tautological one-liners; leave rationale comments.
- **Lens:** unnecessary comments

### 5. `ci-postgres-coverage.test.ts` preamble novel — **trim / S**

- **Path:** `apps/core/src/test/ci-postgres-coverage.test.ts`
- **Why:** ~40-line history of a CI miss before the first assertion. The test body already encodes the rule. Keep a short “why this exists / what it does not catch”; cut the six-files / timestamps story.
- **Lens:** unnecessary comments

### 6. Unwired ops scripts (not dead) — **simplify / S**

- **Paths:** `scripts/soko-bot-prepare-evaluation.mts`, `scripts/soko-bot-runner-local.mts`
- **Why:** No `package.json` script entries. Still referenced: prepare via header `pnpm exec tsx …`; runner-local via `docs/soko-bot/deployment.md` and `.env.example`. Not unused code.
- **Action (optional):** Add `soko-bot:prepare-evaluation` / `soko-bot:runner-local` scripts for discoverability, or leave as intentional ad-hoc `tsx` entrypoints. Do **not** delete.
- **Lens:** needless complexity (discoverability / package surface), not dead

### 7. Giant task-schedule Prisma double — **simplify / L**

- **Path:** `apps/core/src/test-fixtures/task-schedule.ts` (~827 LOC) (+ thin `task-schedule-app.ts`)
- **Why:** Heavily used by schedule route/service tests (alive). Needless complexity is the monolith: IDs/seeds, in-memory store, and a large Prisma-shaped facade in one file. Hard to kill slices without breaking many `vi.mock` factories.
- **Action:** Split into `task-schedule-ids.ts` / `task-schedule-store.ts` / `task-schedule-prisma.ts` (or similar) without behavior change. No export looked unused in whole-Core scan (`MEMBER_ID`, `PERSONAL_WORKSPACE`, `SOKO_BOT_AUTH`, `runsOf`, `seedTaskUpdate`, `requestPendingWorkspaceGrant` all have callers).
- **Lens:** needless complexity

### 8. Thin `getBetterAuthProductionUrl` module — **simplify / S** (optional)

- **Path:** `apps/core/src/config/better-auth-production-url.ts` (12 LOC)
- **Why:** Single call through to `@sokosumi/utils` + `getEnv()`. Only consumer: `src/lib/auth.ts` (excluded tree). Fine as seam; optional inline into `env.ts` next to `getBetterAuthPublicBaseUrl` to shrink config surface.
- **Lens:** needless complexity (mild). Prefer leave unless touching auth URL helpers anyway.

### 9. Deprecated job `user` / `userId` aliases — **leave (sunset later) / M**

- **Path:** `apps/core/src/types/job.ts` (`flattenJob`, `serializeJobDetails`)
- **Why:** Marked deprecated; web production job paths use `ownerId`. Aliases still **required** in `schemas/job.schema.ts` (excluded) and generated core-client types. Killing here without schema/client migration breaks OpenAPI.
- **Action:** Track sunset with schema + client migration; out of leftover-surface kill scope today.
- **Lens:** dead/killable (blocked)

---

## Package.json scripts

| Script | Verdict |
| --- | --- |
| `dev` / `build` / `vercel-build` / `start` | Live |
| `format*` / `lint*` / `check*` / `typecheck` / `test*` | Live |
| `write-openapi-snapshot` | Used by `@sokosumi/core-client` `generate:snapshot` |
| `image-studio:refresh-catalog` | Documented in script header; ops |
| `bench:coworker-chat` | Root `package.json` + `docs/coworker/benchmarks` |
| `soko-bot:copy-avatars` / `judge-eval` / `router-eval` | `docs/soko-bot/deployment.md` |
| `soko-bot:lab` / `tool-smoke` / `trace` | Ops; self-documented; no CI — keep |

**No package.json script looked unused.** Gap is the reverse: two script *files* without npm script names (finding 6).

---

## Types / test fixtures — unused check

| Area | Result |
| --- | --- |
| `types/agent.ts` | `agentCategoriesInclude` / `agentDetailInclude` used by agent routes + summary helper |
| `types/link.ts` | Used by job links routes |
| `types/job.ts` | Used widely; aliases blocked (finding 9) |
| `types/task.ts` / `task-link.ts` / `project.ts` | Used by routes/helpers; exports verified |
| `test-fixtures/*` | All nine modules have callers |
| `test/jev-routes.ts` | Used by classifier / control-plane / confirmation tests |
| `test/setup.ts` | Vitest setup |
| `test/opt-in-db-collect.test.ts` / `ci-postgres-coverage.test.ts` | Live meta-tests |

---

## Platform lens (`apps/core/AGENTS.md`)

In-scope code largely matches Core layout: env Zod in `config/env.ts`, CORS helper, runner as sandbox entry (second `tsup` entry + `vercel.json` `includeFiles`), types for Prisma includes/flatteners as documented.

No in-scope violations of response helpers / auth class rules (those live in excluded routes). Boot still uses `console.log` in `serve` callback — acceptable before request middleware; not ranked.

---

## Walked files

**`src/soko-bot-runner/`:** `index.ts`, `local-tools.ts`, `local-tools.test.ts`  
**`src/config/`:** `env.ts`, `env.test.ts`, `constants.ts`, `cors-allow-origin.ts`, `cors-allow-origin.test.ts`, `social-providers.ts`, `better-auth-production-url.ts`  
**`src/types/`:** `agent.ts`, `job.ts`, `link.ts`, `project.ts`, `project.test.ts`, `task.ts`, `task-link.ts`, `task-link.test.ts`  
**`src/test/`:** `setup.ts`, `jev-routes.ts`, `opt-in-db-collect.test.ts`, `ci-postgres-coverage.test.ts`  
**`src/test-fixtures/`:** all 9 files  
**Entry:** `src/index.ts`, `src/index.test.ts`  
**`scripts/`:** all 12 `.mts`/`.mjs` + `fixtures/soko-bot-router-cases.json`  
**`fixtures/`:** `soko-bot-lab-quiet/*`  
**Meta:** `package.json`, `tsup.config.ts`, `vitest.config.ts` (referenced by test/), `public/favicon.ico` (referenced by Scalar favicon URL)

---

## Left alone

- Hard skips listed above (none appear under this leftover surface)
- Excluded trees (`helpers`, `lib`, `routes`, `services`, `clients`, `middleware`, `schemas`)
- Vendor skill trees under `apps/core/.agents/skills` / `.claude/skills`
- Live ops scripts and their fixtures (`scripts/fixtures/soko-bot-router-cases.json`)
- `public/favicon.ico`
- Deprecated job aliases until schema sunset
- `soko-bot-runner` loop structure / comments that document Gemini/OpenAI tool-name constraints (keep)
- `task-schedule` fixture *behavior* (simplify layout only if pursued)

---

## Suggested kill order

1. Delete `apps/core/fixtures/soko-bot-lab-quiet/` (finding 1) — only pure deletion today  
2. Trim comments in `index.ts`, `constants.ts`, `env.ts` FILES_JEV block, `ci-postgres-coverage.test.ts` (2–5)  
3. Optionally wire prepare-evaluation / runner-local npm scripts (6)  
4. Optionally split `task-schedule` fixture (7) in a dedicated cleanup PR  
