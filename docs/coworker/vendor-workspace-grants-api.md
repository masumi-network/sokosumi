# Coworker API: vendor workspace grants

Guide for **coworker integrators** calling the Sokosumi Core API (`apps/core`). Humans
manage grants via org/user vendor-grant routes; coworkers interact with grants
implicitly through task and job endpoints.

> **Hermes / first-party orchestrators** do **not** use this grant model. They
> authenticate as `actor: orchestrator` (shared `ORCHESTRATOR_SERVICE_TOKEN`) and skip vendor grants /
> whitelist. See [`docs/orchestrator/hermes-orchestrator-actor.md`](../orchestrator/hermes-orchestrator-actor.md).

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
| **None / PENDING** | Baseline task access only (see below). Out-of-scope read/comment → upsert **PENDING** grant, return **403** `grant_required`. Delegated create → task parked as **`GRANT_PENDING`** (a coworker with no relationship to the user must also be whitelisted). |
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

All rows above assume an **approved** delegation. A bootstrap context (no
relationship with the context user) reaches only `POST /v1/tasks`, always parks,
and requires a whitelisted coworker — see [Two tiers](#two-tiers-approved-and-bootstrap).

**Unchanged:**

- **`tasks` capability** required on all task/job routes.
- **DRAFT** tasks invisible to coworkers (404 / excluded from list).
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

**Grant admin routes** (`/v1/organizations/{id}/vendor-grants/*`,
`/v1/users/{id}/vendor-grants/*`) return **403** for coworker auth (bare or
with context headers). Humans (session) or Hermes orchestrator with workspace
context may create, approve, deny, or revoke.

### Context requires an existing delegation

Supplying `X-Context-User-Id` is not by itself authorization. A coworker key is
issued to a third-party vendor and the header value is caller-chosen, so
`coworkerContextMiddleware` attaches context only when the coworker already has
a relationship with that user (`apps/core/src/middleware/coworker-delegation.ts`):

- a `CoworkerAssignment` for that user, **or**
- a **GRANTED** vendor grant on that user's personal workspace or on a workspace
  of an organization they belong to, **or**
- a task already assigned to that coworker and owned by that user.

Without a relationship the context is marked **bootstrap** rather than approved,
and every route except delegated create rejects it with **403** (see the two
tiers below). Orchestrator service tokens are first-party and exempt. Without
this, any vendor key could name any user id and be treated as that user on every
route that resolves the effective user through `requireUserContext` —
notifications, history, projects, organization billing and members.

A **PENDING** grant deliberately does not count. Reaching any task route with an
existing relationship causes `requireGrantedWorkspaceAccessOrRequest` to create a
PENDING grant on that *workspace*; accepting it here would let one member's
engagement hand the vendor context for every other member of the same
organization before a human approved anything.

### Two tiers: approved and bootstrap

Context comes in two tiers, so the check above does not break first contact:

| Tier | When | Reaches |
| --- | --- | --- |
| **Approved** | one of the relationships above holds | every user-scoped route, as before |
| **Bootstrap** | none of them hold | **only** `POST /v1/tasks` (delegated create) |

A bootstrap context is what makes the `GRANT_PENDING` cold start below possible:
a vendor with no relationship can create its first task, which parks as
`GRANT_PENDING` and notifies approvers — it can *ask* for access, but it cannot
read or mutate anything. Every other route rejects it with **403** inside
`requireUserContext`, and delegated create refuses to produce an unparked task
from it even if the grant lookup were to disagree.

The flag is fail-closed: only an explicit approval from the middleware counts,
so a context assembled any other way is treated as bootstrap.

Bootstrap create additionally requires the coworker to be **whitelisted**
(`Coworker.isWhitelisted`, platform-admin controlled, default `false`). Cold
start writes a task row and notifies the workspace's approvers with
caller-supplied text, so it is limited to platform-approved coworkers rather than
any vendor key. A non-whitelisted vendor needs an assignment or an approved grant
arranged out of band first.

---

## Delegated create (`POST /v1/tasks`)

Applies when auth is coworker **with** user context. Session-only user create is
unchanged (no grant gate).

0. **Bootstrap contexts only:** the coworker must be whitelisted, else **403**
   before anything is written or notified. Approved delegations skip this.
1. Single transaction: validate project → `requestWorkspaceGrant` → insert task.
2. **`GRANTED`** → create at `body.status` (`DRAFT` or `READY`) — but only when
   the delegation is approved. A bootstrap context always parks, even here.
3. **`PENDING`** → `status: GRANT_PENDING`, `grantResumeStatus` ← `body.status`,
   `pendingVendorGrantId` ← grant id; approvers notified post-commit (best-effort).
4. **`DENIED` / `REVOKED`** → **403**, no task row.

After human **approve**: task unparks to `grantResumeStatus` (null → `READY`).
After **deny/revoke** on the create grant: parked task → **`CANCELED`**.

---

## Endpoint reference (coworker-facing)

| Method | Route | Behavior |
| --- | --- | --- |
| GET | `/v1/tasks` | With **GRANTED** grant, list all non-DRAFT tasks in workspace. `status=DRAFT` filter → **400**. |
| GET | `/v1/tasks/{id}` | Baseline unchanged. Out-of-scope: upsert PENDING grant, **403** unless **GRANTED**. Same gate for task events, links, jobs list. |
| POST | `/v1/tasks` | Delegated create flow above. |
| POST | `/v1/tasks/{id}/events` | **`GRANT_PENDING`** → **403** `task_parked`. |
| POST | `/v1/tasks/{id}/jobs` | Parent **`GRANT_PENDING`** → **403** `task_parked`. |
| PATCH | `/v1/tasks/{id}` (+ schedule, etc.) | Collaborators cannot mutate parked tasks. |
| GET | `/v1/jobs/{id}` | Sibling read uses workspace grant gate; writes blocked if parent task parked. |

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

- [Coworker metadata](./../coworker-metadata.md) — marketplace profile and offers JSON
- [Core AGENTS.md](../../apps/core/AGENTS.md) — route patterns and auth
- PR [#3300](https://github.com/masumi-network/sokosumi/pull/3300) — full feature summary and test plan
