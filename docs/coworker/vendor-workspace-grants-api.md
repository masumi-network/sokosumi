# Coworker API: vendor workspace grants

Guide for **coworker integrators** calling the Sokosumi Core API (`apps/core`). Humans
manage grants via org/user vendor-grant routes; coworkers interact with grants
implicitly through task and job endpoints.

> **Related — not the same as coworker early access.** `VendorGrant` is
> **vendor × workspace** task access for coworker **actors** (baseline /
> `GRANT_PENDING` / delegated create). Making a non-whitelisted coworker
> pickable in chat/tasks for humans uses `CoworkerWorkspaceAccess` instead —
> see [`coworker-workspace-access-api.md`](./coworker-workspace-access-api.md).

> **Soko Bot** does not authenticate as a coworker. Its in-process Core loop
> receives short-lived, turn-scoped grants and invokes capability tools.
> Delegated Coworker work still follows this vendor-grant model.

- **Source of truth (behavior):** `apps/core/src/helpers/access-control.ts`,
  `apps/core/src/helpers/vendor-grants.ts`, `apps/core/src/routes/v1/tasks/*`
- **Source of truth (OpenAPI shape):** `apps/core/src/schemas/task.schema.ts`
- **Shipped in:** PR [#3300](https://github.com/masumi-network/sokosumi/pull/3300)
  (`feat(vendor-grants)`)

---

## Permission model

One **workspace** grant per `(vendorId, workspaceId)`:

| Grant status | Coworker effect |
| --- | --- |
| **None / PENDING** | Baseline task access only (see below). Out-of-scope read/comment → upsert **PENDING** grant, return **403** `grant_required`. Delegated create → task parked as **`GRANT_PENDING`**. |
| **GRANTED** | Read, list, comment, and create across the whole workspace (all non-DRAFT tasks). |
| **DENIED / REVOKED** | **403** `grant_denied` / `grant_revoked`. Terminal — Core does not auto-reopen. |

Read, list, comment, and create are **all-or-nothing** when granted (no separate
read vs create permissions).

**Serviceplan:** new and backfilled workspaces auto-GRANT the Serviceplan vendor
(`slug: serviceplan`), so coworkers usually skip PENDING for those workspaces.

---

## Task API fields

| Field | Type | When set | Purpose |
| --- | --- | --- | --- |
| `status` | enum | always | New value **`GRANT_PENDING`** while waiting on workspace grant approval |
| `grantResumeStatus` | `DRAFT` \| `READY` \| `null` | `status === GRANT_PENDING` | Target status after approval; `null` when not parked |
| `pendingVendorGrantId` | uuid \| `null` | `status === GRANT_PENDING` | **Exposed on the task API** so integrators can correlate the parked task with the blocking grant. Cleared when not parked. |

Both `grantResumeStatus` and `pendingVendorGrantId` are returned as **`null`**
when the task is not parked (not omitted from the JSON payload).

**Design decision:** these fields are **intentionally exposed on the Core task
API** while parked (not DB-only). Coworker integrators and the web app use
`pendingVendorGrantId` to correlate a blocked task with its vendor grant; hiding
it would force extra lookups without improving security (grant admin remains
human-only).

On approve/unpark, if `grantResumeStatus` is missing (legacy row), Core defaults
to **`READY`**.

**OpenAPI:** descriptions live in `apps/core/src/schemas/task.schema.ts` and
propagate to the generated web client via `pnpm --filter web generate:core:snapshot`.

---

## Access tiers

| Tier | Read single task | List `GET /v1/tasks` | `POST /v1/tasks` (delegated) | Comment |
| --- | --- | --- | --- | --- |
| **Baseline** | Assignee + same-vendor sibling (non-DRAFT) | Same OR filter | Parks as **`GRANT_PENDING`** if no **GRANTED** grant | Baseline tasks only |
| **PENDING** grant | **403** `grant_required` (grant row upserted) | Still baseline-only | **201** + `GRANT_PENDING` + `pendingVendorGrantId` | **403** on out-of-scope |
| **GRANTED** grant | Any non-DRAFT task in workspace | All non-DRAFT workspace tasks | Create at requested `DRAFT`/`READY` | Any readable non-parked task |

**Unchanged:**

- **`tasks` capability** required on all task/job routes.
- **DRAFT** tasks invisible to coworkers on list/read (404 / excluded from list).
- **Bare coworker auth** (no user context headers): no delegated create; list uses
  baseline filter only.

### Baseline access

A coworker has baseline access when:

- They are the **assignee** (`task.assigneeId`), or
- The assignee is another coworker from the **same vendor** (vendor sibling),

and the task is **not DRAFT**.

---

## Authentication

**Delegated create** and workspace-scoped list/read require:

- Coworker API token (`actor: coworker`)
- Delegation context headers:
  - **`X-Context-User-Id`** (required for delegated flows)
  - **`X-Context-Organization-Id`** (optional; when set, user must be a member)
- Workspace-scoped routes resolve the active workspace from that user/org context
  (see `withCoworkerContextHeaderParameters` in `apps/core/src/lib/hono.ts`,
  parameter components in `apps/core/src/routes/v1/index.ts`, and
  `apps/core/src/middleware/coworker-context.ts`). OpenAPI only documents
  `X-Context-*` on operations that accept coworker or orchestrator context auth.

Middleware only **attaches** context after validating that the user exists (and
org membership when an org header is set). It does **not** authorize
user-scoped act-as-user. Handlers pick a shared helper — do not branch on
`actor` in route files:

| Helper | Coworker + `X-Context-*` |
| --- | --- |
| `requireUserContext` | Allowed without grant check (task/job grant gates only) |
| `requireAuthorizedUserContext` | Allowed only after binding: **DENIED/REVOKED** reject (assignment does not override); **GRANTED** allow; else **baseline** assignee/sibling task; else reject. Default for user-scoped routes (credits, profile, projects, …). |
| `requireOwnerUserContext` | Always **403** (notifications, billing, member lists, …) |

See `apps/core/AGENTS.md` (Handler actor menu) and
`apps/core/src/helpers/coworker-user-context-binding.ts`.

**Grant admin routes** (`/v1/organizations/{id}/vendor-grants/*`,
`/v1/users/{id}/vendor-grants/*`) return **403** for coworker auth (bare or
with context headers). Session users or Soko Bot with workspace
context may create, approve, deny, or revoke.

---

## Delegated create (`POST /v1/tasks`)

Applies when auth is coworker **with** user context. Session-only user create is
unchanged (no grant gate).

1. Single transaction: validate project → `requestWorkspaceGrant` → insert task.
2. **`GRANTED`** → create at `body.status` (`DRAFT` or `READY`).
3. **`PENDING`** → `status: GRANT_PENDING`, `grantResumeStatus` ← `body.status`,
   `pendingVendorGrantId` ← grant id; approvers notified post-commit (best-effort).
4. **`DENIED` / `REVOKED`** → **403**, no task row.

After human **approve**: task unparks to `grantResumeStatus` (null → `READY`).
After **deny/revoke** on the create grant: parked task → **`CANCELED`**.

---

## Task Schedules (`/v1/tasks/schedules`)

A repeating rule is a **Task Schedule**, its own resource
([ADR 0041](../adr/0041-recurring-rules-move-to-task-schedule.md)). It holds the
rule (cron `expr` or every `intervalDays` from `anchorAt`, `timezone`, end rule)
and the blueprint of the Task each Run creates (name, description, project,
visibility, one assignee of any kind). At every Run, Core creates a new `READY`
Task that carries the schedule's id in `scheduleId`. A Task never repeats; a
one-time start is `runAt` on `POST /v1/tasks`.

A Coworker needs `X-Context-*` headers, the `tasks` capability, and a
**GRANTED** workspace grant. A missing grant is requested and the call answers
**403** `grant_required` until a human approves; nothing parks. The
organization seat applies to the contextual user, and Task Schedules are not
behind the Calendar beta. The Coworker reads the workspace's public schedules
and the contextual user's private ones in its vendor family, as for Tasks. It
changes only the contextual user's schedules that it created or whose assignee
is in its vendor family. A schedule's workspace is fixed at creation.

`POST /v1/tasks/schedules` takes an optional `operationId` (a UUID, scoped to
the workspace) so a timed-out create can be retried safely: a retry with the
same key and body returns the schedule the first request made, and the same
key with a different body or from another creator answers **409**
`schedule_operation_conflict`. Without it, every create makes a new schedule.

`PATCH /v1/tasks/schedules/{id}` takes the `expectedRevision` the caller read
and answers **409** `schedule_revision_conflict` when the schedule changed.
Pause, resume, and end answer **409** `schedule_state_conflict` from the wrong
state. A Run change answers **409** `schedule_run_state_conflict` or **422**
`schedule_run_target_invalid`.

### Removed per-Task schedule routes

The old per-Task schedule routes answer **410 Gone** with `kind`
`task_schedule_moved` and the route to call instead in `replacement`:

| Removed route | `replacement` |
| --- | --- |
| `POST /v1/tasks/scheduled` | `POST /v1/tasks/schedules` |
| `PUT /v1/tasks/{id}/schedule` | `POST /v1/tasks/schedules` (a one-time start is `runAt` on `POST /v1/tasks`) |
| `DELETE /v1/tasks/{id}/schedule` | `DELETE /v1/tasks/schedules/{id}` |
| `PUT /v1/tasks/{id}/calendar-schedule` | `PATCH /v1/tasks/schedules/{id}` |
| `PUT /v1/tasks/{id}/calendar-source` | `PATCH /v1/tasks/schedules/{id}` |
| `GET /v1/tasks/{id}/schedule/occurrences` | `GET /v1/tasks/schedules/{id}/runs` |
| `PATCH /v1/tasks/{id}/schedule/occurrences/{occurrenceId}` | `PATCH /v1/tasks/schedules/{id}/runs/{runId}` |

The Task DTO no longer carries `metadata`, `nextRunAt`, or `scheduleRevision`,
and `GET /v1/tasks` no longer accepts `hasSchedule` or `sort=nextRunAt`. It
carries `runAt` and `scheduleId`; filter `GET /v1/tasks?scheduleId=` for the
Tasks a schedule created. Task events no longer carry `scheduleKind`,
`schedulePayload`, or `scheduleOperationId`. Calendar items no longer carry
`sourceAccuracy` or `timeAccuracy`, and `LEGACY_UNKNOWN` is gone from
`sourceType`.

---

## Endpoint reference (coworker-facing)

| Method | Route | Behavior |
| --- | --- | --- |
| GET | `/v1/tasks` | With **GRANTED** grant, list all non-DRAFT tasks in workspace. `status=DRAFT` filter → **400**. |
| GET | `/v1/tasks/{id}` | Baseline unchanged. Out-of-scope: upsert PENDING grant, **403** unless **GRANTED**. Same gate for task events, links, jobs list. |
| POST | `/v1/tasks` | Delegated create flow above. Optional `runAt` (future time, Coworker or Soko Bot assignee required) creates the Task in `QUEUED`; Core moves it to `READY` at that time and clears `runAt`. `runAt` cannot park: while the grant is pending it answers **422**. |
| GET, POST | `/v1/tasks/schedules` | List (filters `projectId`, `state`) and create Task Schedules. See Task Schedules above. |
| GET, PATCH, DELETE | `/v1/tasks/schedules/{id}` | Read, edit (revision-checked), or delete a Task Schedule. Deleting keeps the Tasks it created. |
| POST | `/v1/tasks/schedules/{id}/pause`, `/resume`, `/end` | Change the schedule's state (Active, Paused, Ended). |
| GET | `/v1/tasks/schedules/{id}/runs` | List the schedule's Runs. |
| PATCH | `/v1/tasks/schedules/{id}/runs/{runId}` | Skip, move, or restore one upcoming Run. |
| POST | `/v1/tasks/{id}/events` | **`GRANT_PENDING`** → **403** `task_parked`. |
| POST | `/v1/tasks/{id}/jobs` | Parent **`GRANT_PENDING`** → **403** `task_parked`. |
| PATCH | `/v1/tasks/{id}` | Collaborators cannot mutate parked tasks. |
| GET | `/v1/jobs/{id}` | Sibling read uses workspace grant gate; writes blocked if parent task parked. |

On these Task-collaboration routes, a standalone Coworker key (no
`X-Context-*` headers) skips the user-scoped gates and is scoped by the Task
relationship: mutations require the Task to be assigned to the calling
Coworker, and reads may also use the vendor-sibling baseline. Status
transitions, jobs, and files stay assignee-only. Task Schedule routes always
need `X-Context-*` headers.

---

## Error responses (`403`)

All use the standard Core error envelope. Relevant `error.kind` values:

| `kind` | When | `extensions` |
| --- | --- | --- |
| `grant_required` | Workspace access needed; PENDING grant created or already waiting | `permission: "workspace"` |
| `grant_denied` | Grant denied; will not auto-reopen | `permission: "workspace"` |
| `grant_revoked` | Grant revoked | `permission: "workspace"` |
| `task_parked` | Task is **`GRANT_PENDING`** — mutations, comments, jobs frozen | — |

Integrators should handle `grant_required` by surfacing approval UX to the human
and polling task/coworker events until the grant resolves or the task unparks.

---

## Events and polling

- Parked create emits an initial task event with status **`GRANT_PENDING`**.
- Grant approve/deny/revoke and unpark/cancel side-effects appear on
  **`GET /v1/coworkers/me/events`** (same polling model as other task lifecycle
  events).

Use `pendingVendorGrantId` on the task (while parked) if you need to show which
grant is blocking progress; resolve grant details via human-facing settings UI or
wait for unpark/cancel events.

---

## Related docs

- [Coworker workspace early access](./coworker-workspace-access-api.md) — human-side pilot grants (not VendorGrant)
- [Coworker metadata](./../coworker-metadata.md) — marketplace profile and offers JSON
- [Core AGENTS.md](../../apps/core/AGENTS.md) — route patterns and auth
- PR [#3300](https://github.com/masumi-network/sokosumi/pull/3300) — full feature summary and test plan
