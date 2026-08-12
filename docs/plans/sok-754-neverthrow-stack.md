# SOK-754 — Ban ts-res; neverthrow stack

## Goal

Migrate web Results off `@/lib/ts-res` onto neverthrow + `ActionResultDto` wire shape (SOK-762). Ship as **GitHub stacked PRs** (`gh stack`).

## Status

**Stack complete.** Expand (SOK-762) and migrate layers (SOK-763…767) landed on `main`; contract (SOK-768) deletes `ts-res` and enforces neverthrow-only.

| Phase | Issue | PR | Status |
| -- | -- | -- | -- |
| Expand | SOK-762 | #3734 | Merged |
| Migrate | SOK-763 | #3737 | Merged |
| Migrate | SOK-764 | #3738 | Merged |
| Migrate | SOK-765 | #3739 | Merged |
| Migrate | SOK-766 | #3740 | Merged |
| Migrate | SOK-767 | #3741 | Merged |
| Contract | SOK-768 | #3742 | This PR |

## Locked pattern (SOK-762)

| Layer | Shape |
|-------|--------|
| In-process | `import { ok, err, type Result } from "neverthrow"` |
| Action return | `toActionResult(result)` → `ActionResultDto<T,E>` = `{ ok: true; value: T } \| { ok: false; error: E }` |
| Clients | `if (!result.ok) …` then `result.value` (never `result.data`) |

## PR Plan (as executed)

### PR 1: SOK-763 coworker early-access — landed

- **Description:** Migrate coworker early-access actions + UI off ts-res.
- **Files/components affected:** `workspace-access.action.ts`, `account/coworker-access-action.ts`, `organization/coworker-access-action.ts`, `coworker-access-list.tsx`, `developer-coworker-early-access.tsx`, related tests
- **Call-site rule:** only edit callers that read `result.data` (or type as `ts-res` `Result`). Pure `result.ok` / `result.error` UIs (e.g. `coworker-access-notification-actions.tsx`) need **verify only** — no code change if they never touch the success payload.
- **Branch:** `sok-763-neverthrow-coworker-early-access`

### PR 2: SOK-764 vendor-grant — landed

- **Description:** Migrate vendor-grant domain actions + UI.
- **Files/components affected:** `account/vendor-grant-action.ts`, `organization/vendor-grant-action.ts`, `vendor-grants/*`, `tasks-pending-vendor-grant-banner.tsx`, tests
- **Branch:** `sok-764-neverthrow-vendor-grant`

### PR 3: SOK-765 admin surface — landed

- **Description:** Migrate admin action modules + admin UI callers.
- **Files/components affected:** `admin-*`, `free-credit-admin`, `invoice-admin`, `vendors/vendor-admin.action.ts`, admin components using `result.data`
- **Branch:** `sok-765-neverthrow-admin-actions`

### PR 4: SOK-766 auth / onboarding / oauth / subscription — landed

- **Description:** Migrate auth, onboarding, oauth, subscription, seat.
- **Files/components affected:** `auth/action.ts`, `onboarding/action.ts`, `oauth/action.ts`, `subscription/*`, `organization/seat-action.ts`, related UI
- **Branch:** `sok-766-neverthrow-auth-onboarding`

### PR 5: SOK-767 remaining — landed

- **Description:** All leftover ts-res production imports (org, credits, hermes, jobs, design-md, coworker display, enterprise, ratings, stragglers).
- **Files/components affected:** remaining `@/lib/ts-res` importers outside module itself
- **Branch:** `sok-767-neverthrow-remaining`

### PR 6: SOK-768 delete + enforce — this PR

- **Description:** Delete `apps/web/src/lib/ts-res`, zero imports, path regression test + agent docs ban.
- **Files/components affected:** `ts-res/*`, neverthrow rule, `AGENTS.md`, `no-ts-res` test
- **Branch:** `sok-768-delete-ts-res-enforce`

## Stack ops (historical)

Stack was managed with GitHub stacked PRs (`gh stack`):

```bash
gh stack init \
  sok-763-neverthrow-coworker-early-access \
  sok-764-neverthrow-vendor-grant \
  sok-765-neverthrow-admin-actions \
  sok-766-neverthrow-auth-onboarding \
  sok-767-neverthrow-remaining \
  sok-768-delete-ts-res-enforce

gh stack submit --auto
```

Merged bottom-up into `main`.

## Non-goals

- Core API error shapes
- Behaviour changes beyond Result envelope rename (`data` → `value`)
