# SOK-754 — Ban ts-res; neverthrow stack

## Goal

Migrate web Results off `@/lib/ts-res` onto neverthrow + `ActionResultDto` wire shape (SOK-762). Ship as **GitHub stacked PRs** (`gh stack`).

## Locked pattern (SOK-762)

| Layer | Shape |
|-------|--------|
| In-process | `import { ok, err, type Result } from "neverthrow"` |
| Action return | `toActionResult(result)` → `ActionResultDto<T,E>` = `{ ok: true; value: T } \| { ok: false; error: E }` |
| Clients | `if (!result.ok) …` then `result.value` (never `result.data`) |

## PR Plan

### PR 1: SOK-763 coworker early-access

- **Description:** Migrate coworker early-access actions + UI off ts-res.
- **Files/components affected:** `workspace-access.action.ts`, `account/coworker-access-action.ts`, `organization/coworker-access-action.ts`, `coworker-access-list.tsx`, `developer-coworker-early-access.tsx`, `coworker-access-notification-actions.tsx`, related tests
- **Dependencies:** None (SOK-762 merged on main)
- **Branch:** `sok-763-neverthrow-coworker-early-access`

### PR 2: SOK-764 vendor-grant

- **Description:** Migrate vendor-grant domain actions + UI.
- **Files/components affected:** `account/vendor-grant-action.ts`, `organization/vendor-grant-action.ts`, `vendor-grants/*`, `tasks-pending-vendor-grant-banner.tsx`, tests
- **Dependencies:** PR 1
- **Branch:** `sok-764-neverthrow-vendor-grant`

### PR 3: SOK-765 admin surface

- **Description:** Migrate admin action modules + admin UI callers.
- **Files/components affected:** `admin-*`, `free-credit-admin`, `invoice-admin`, `vendors/vendor-admin.action.ts`, admin components using `result.data`
- **Dependencies:** PR 2
- **Branch:** `sok-765-neverthrow-admin-actions`

### PR 4: SOK-766 auth / onboarding / oauth / subscription

- **Description:** Migrate auth, onboarding, oauth, subscription, seat.
- **Files/components affected:** `auth/action.ts`, `onboarding/action.ts`, `oauth/action.ts`, `subscription/*`, `organization/seat-action.ts`, related UI
- **Dependencies:** PR 3
- **Branch:** `sok-766-neverthrow-auth-onboarding`

### PR 5: SOK-767 remaining

- **Description:** All leftover ts-res production imports (org, credits, hermes, jobs, design-md, coworker display, enterprise, ratings, stragglers).
- **Files/components affected:** remaining `@/lib/ts-res` importers outside module itself
- **Dependencies:** PR 4
- **Branch:** `sok-767-neverthrow-remaining`

### PR 6: SOK-768 delete + enforce

- **Description:** Delete `apps/web/src/lib/ts-res`, zero imports, CI/docs ban.
- **Files/components affected:** `ts-res/*`, neverthrow rule, biome/CI guard if any
- **Dependencies:** PR 5
- **Branch:** `sok-768-delete-ts-res-enforce`

## Stack ops

```bash
gh stack init \
  sok-763-neverthrow-coworker-early-access \
  sok-764-neverthrow-vendor-grant \
  sok-765-neverthrow-admin-actions \
  sok-766-neverthrow-auth-onboarding \
  sok-767-neverthrow-remaining \
  sok-768-delete-ts-res-enforce

# After each layer is committed on its branch:
gh stack submit --auto   # drafts by default
```

## Non-goals

- Core API error shapes
- Behaviour changes beyond Result envelope rename (`data` → `value`)
