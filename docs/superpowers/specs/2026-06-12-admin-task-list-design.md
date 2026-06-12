# Admin Task List — Design (SOK-566)

Linear: [SOK-566](https://linear.app/masumi/issue/SOK-566/add-searchable-admin-task-list)

## Goal

A searchable admin view listing all tasks so any task can be found quickly
across users and organizations. Search supports user, organization, task ID,
and task name.

## Architecture

Follows the established web → core split (same shape as the admin user
overview, SOK-565): a new admin Core endpoint owns all database access; the
web app consumes it through the generated Core client, a web service, and a
server action.

### Core API

**New route**: `GET /v1/admin/tasks`
(`apps/core/src/routes/v1/admin/tasks/get.ts` + `index.ts`, mounted on the
admin router in `apps/core/src/routes/v1/admin/index.ts`, which already
enforces `requireAdmin`).

- **Query params**: `cursorPaginationQuerySchema` (`cursor`, `limit`, capped
  at `ADMIN_TASK_LIST_MAX_LIMIT = 50` like the user overview) plus an
  optional `query` string. An empty or missing `query` returns all tasks.
- **Search semantics** (single omnibox term, trimmed): rows match when ANY of
  the following match —
  - task `id` equals the term (exact match; task IDs are uuids),
  - task `name` contains the term (case-insensitive),
  - owning user `name` or `email` contains the term (case-insensitive),
  - organization `name` or `slug` contains the term (case-insensitive).
- **Scope**: all tasks, including `DRAFT` and archived rows — this is an
  admin lookup tool, nothing is hidden.
- **Ordering**: `createdAt` desc, `id` desc tiebreak (uuid v7).
- **Data access**: direct Prisma `findMany`/`count` in a `$transaction` with
  `include` for `user` and `organization`, matching the existing
  `/v1/tasks` route. No new repository method is needed — the query has no
  per-row fan-out.
- **Response rows** (`adminTaskListItemSchema` in
  `apps/core/src/schemas/admin.schema.ts`):
  - `id`, `name`, `status` (`TaskStatus` enum), `createdAt`
  - `user` — `{ id, name, email }`
  - `organization` — `{ id, name, slug } | null` (personal-workspace tasks
    have no organization)
- **Response envelope**: `jsonPaginatedSuccessResponse` with
  `createPaginationMeta`, same as `/v1/admin/users/overview`.

### Web

- **Admin hub**: add a `tasks` entry to `ADMIN_SECTIONS`
  (`apps/web/src/app/(app)/admin/admin-sections.ts`) with the `ListTodo`
  lucide icon, plus `App.Admin.Overview.Sections.tasks` translations.
- **Page**: `apps/web/src/app/(app)/admin/tasks/page.tsx` — server component
  (admin layout already enforces the admin session), fetches the first page
  via the service and renders the list component.
- **Service**: `apps/web/src/lib/services/admin-task.service.ts` with
  `listTasks({ query?, cursor?, limit? })` calling the regenerated Core
  client.
- **Action**: `listAdminTasksAction` in
  `apps/web/src/lib/actions/admin-tasks/action.ts`, mirroring
  `admin-users/action.ts` (`withSession` + `assertAdminSession` + `Result`).
- **Component**: `apps/web/src/components/admin/tasks/task-list.tsx` — client
  component modeled on `user-list.tsx`: debounced search input driving the
  server action, shadcn `Table` with columns Task (name + id), User
  (name + email), Organization, Status (badge), Created; cursor-based
  "Load more" button; total count.
- **i18n**: `App.Admin.Tasks.*` keys added to all locale catalogs.
- **Client regeneration**: `pnpm --filter web generate:core:snapshot` after
  the Core schema/route lands; generated files committed as-is.

## Decisions & assumptions

1. **Single omnibox search** (one `query` matched across all four facets)
   rather than separate per-facet filters — matches the sibling user
   overview UX and the issue's "find quickly" goal.
2. **Task ID matches exactly** — IDs are uuids; substring matching on uuids
   adds noise without value.
3. **DRAFT and archived tasks are included** — admins searching for "any
   task" should see everything; no archived indicator column for now.
4. **Search is server-side** so it works across the full task table, not
   just the loaded page.

## Error handling

- Endpoint inherits admin-router auth: 401 unauthenticated, 403 non-admin.
- Invalid cursor: same Prisma cursor semantics as the other paginated
  endpoints — no bespoke errors.
- Web action maps admin-access errors to `UNAUTHORIZED`, everything else to
  `INTERNAL_SERVER_ERROR`, same as `admin-users/action.ts`.

## Testing

- **Core**: route tests beside `admin-user-overview.routes.test.ts` covering:
  401/403 gating, empty query lists all tasks (incl. DRAFT/archived), search
  by task name, by task ID, by user name/email, by organization name/slug,
  and pagination (cursor + total).
- **Web**: service test for `listTasks` mapping; action test mirroring the
  `admin-users` action tests (admin gate + success path).
