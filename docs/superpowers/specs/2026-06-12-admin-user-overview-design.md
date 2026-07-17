# Admin User Overview — Design (SOK-565)

Linear: [SOK-565](https://linear.app/masumi/issue/SOK-565/add-searchable-admin-user-overview)

## Goal

A searchable admin view listing all users so account status and activity can be
reviewed quickly. Each row shows available credits, current subscription,
number of started tasks, and registration date.

## Architecture

Follows the established web → core split: a new admin Core endpoint owns all
database access; the web app consumes it through the generated Core client, a
web service, and a server action.

### Core API

**New route**: `GET /v1/admin/users/overview`
(`apps/core/src/routes/v1/admin/users/overview/get.ts`, mounted on the
existing admin users router which already enforces `requireAdmin`).

The existing `GET /v1/admin/users` search-picker endpoint (used by the invoice
recipient combobox) is left untouched.

- **Query params**: `cursorPaginationQuerySchema` (`cursor`, `limit`) plus an
  optional `query` string matched case-insensitively against user `name` and
  `email`. Unlike the picker endpoint, an empty `query` returns all users.
- **Ordering**: `createdAt` desc, `id` desc tiebreak. Cursor is the `id` of
  the last row (uuid v7, so id order tracks creation order).
- **Response rows** (`adminUserOverviewItemSchema` in
  `apps/core/src/schemas/admin.schema.ts`):
  - `id`, `name`, `email`
  - `createdAt` — ISO datetime (registration date)
  - `credits` — available personal credits as a number
    (`convertCentsToCredits` at the API boundary)
  - `subscriptionPlan` — `string | null`
  - `subscriptionStatus` — `string | null`
  - `startedTaskCount` — integer
- **Response envelope**: `jsonPaginatedSuccessResponse` with
  `createPaginationMeta` (cursor, limit, total, nextCursor), same as
  `/v1/tasks`.

**Data assembly** (per page of ≤ `LIMITS.MAX_PAGINATION_LIMIT` rows):

1. `userRepository.listUsers({ query, cursor, limit }, tx)` — new repository
   method returning the page of users plus the total count for the filter.
2. Credits: existing `getCredits(userId, null, tx)` helper per row via
   `Promise.all` — reuses the canonical credit-bucket scope logic.
3. Subscription: existing
   `subscriptionRepository.resolveActiveSubscriptionByReferenceId(userId, tx)`
   per row via `Promise.all` — reuses the canonical resolution (current
   in-period row, else latest started active row).
4. Started tasks: one `prisma.task.groupBy({ by: ["ownerId"], where: { ownerId:
   { in: pageUserIds }, status: { not: "DRAFT" } }, _count })`.

Per-row queries are acceptable here: this is an internal admin tool with a
bounded page size, and reusing the canonical helpers avoids duplicating
credit-scope SQL and subscription-resolution logic.

### Web

- **Admin hub**: add a `users` entry to `ADMIN_SECTIONS`
  (`apps/web/src/app/(app)/admin/admin-sections.ts`) with the `Users` lucide
  icon, plus `App.Admin.Overview.Sections.users` translations.
- **Page**: `apps/web/src/app/(app)/admin/users/page.tsx` — server component
  (admin layout already enforces `requireAdminSession`), fetches the first
  page via the service and renders the list component.
- **Service**: extend `apps/web/src/lib/services/admin-user.service.ts` with
  `listUsers({ query?, cursor?, limit? })` calling the regenerated Core
  client.
- **Action**: `listAdminUsersAction` in
  `apps/web/src/lib/actions/admin-users/action.ts`, mirroring
  `admin-search/action.ts` (`withSession` + `assertAdminSession` + `Result`).
- **Component**: `apps/web/src/components/admin/users/user-list.tsx` — client
  component modeled on `invoice-list.tsx`: debounced search input driving the
  server action, shadcn `Table` with columns Name/Email, Credits,
  Subscription, Started tasks, Registered; cursor-based "Load more" button.
- **i18n**: `App.Admin.Users.*` keys added to all locale catalogs.
- **Client regeneration**: `pnpm --filter web generate:core:snapshot` after
  the Core schema/route lands; generated files committed as-is.

## Decisions & assumptions

1. **"Started tasks"** = `Task` rows with `status != DRAFT`. Drafts have not
   been started; every other status implies the task left draft. (Sibling
   issue SOK-566 covers an admin task list, so tasks — not jobs — are the
   unit.)
2. **"Available credits"** = the user's personal credit scope, i.e. the same
   balance the user sees for themselves (`getCredits(userId, null)`), not
   organization balances.
3. **"Current subscription"** = `plan` (and `status`) of the resolved active
   subscription with `referenceId = userId`; null when none — rendered as a
   dash.
4. **Search is server-side** (name/email, case-insensitive contains) so it
   works across the full user table, not just the loaded page.

## Error handling

- Endpoint inherits admin-router auth: 401 unauthenticated, 403 non-admin.
- Invalid cursor: treated like the tasks endpoint (cursor row not found →
  empty page semantics via Prisma cursor behavior) — no bespoke errors.
- Web action maps admin-access errors to `UNAUTHORIZED`, everything else to
  `INTERNAL_SERVER_ERROR`, same as `admin-search/action.ts`.

## Testing

- **Core**: route tests beside the existing admin route tests covering: 401/403
  gating, empty-query lists all users, search filters by name and email,
  pagination (cursor + total), and correctness of credits / subscription /
  started-task-count mapping (repository + helper calls mocked or seeded the
  same way as existing admin tests).
- **Web**: service test for `listUsers` mapping; action test mirroring
  `admin-search` action tests (admin gate + success path).
