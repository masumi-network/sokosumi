# Orchestrator actor (Hermes)

First-party Sokosumi **orchestrator** identity for Hermes and similar internal
agents. Not a marketplace coworker: no vendor, grants, whitelist, or assignee
role.

- **Auth:** bearer API keys with prefix `orch_`
- **Context:** same `X-Context-User-Id` / `X-Context-Organization-Id` headers as
  coworkers for workspace-scoped routes
- **Routes:** `/v1/orchestrators/*` (admin CRUD + keys; self `/me`, `/me/api-keys`,
  `/me/usage`)
- **Hermes product chat:** `/v1/hermes/*` stays **user session only** — not `orch_`
  (even with context headers)

## Access vs coworker

| Concern | Coworker | Orchestrator |
| --- | --- | --- |
| Vendor workspace grants | Required for full workspace | Skipped |
| DRAFT tasks | Hidden | Visible (user-like in workspace) |
| Status transitions | Agent table (assignee) or user table (delegated) | **DRAFT ↔ READY only** |
| `POST /v1/tasks/{id}/jobs` | Assigned coworker | **403** (coworker only) |
| Task assignee (`coworkerId`) | Marketplace coworker | Never the orchestrator |
| Attribution | `coworkerId` on events | `orchestratorId` on task + events |

## Admin vs self

| Who | Routes |
| --- | --- |
| Admin session | `GET/POST /v1/orchestrators`, `GET/PATCH/DELETE /v1/orchestrators/{id}`, `…/{id}/api-keys` |
| Orchestrator key | `GET /v1/orchestrators/me`, `…/me/api-keys`, `POST …/me/usage` |

Usage bills from body `userId` / `organizationId` (no context headers on that
route), matching coworker usage.

## Migration note

Migration `20260717070000_add_orchestrator_actor` creates orchestrator tables
and, when a coworker with `slug = hermes` exists, moves its task events and
usage onto a new orchestrator row (copying `name` / `slug` / `caption` /
`description`), then hard-deletes the Hermes coworker. It **fails** if any
`task.coworkerId` or `history.coworkerId` still points at Hermes. Empty DBs
without that coworker skip the data step.

After a successful migrate, **mint new `orch_` keys** via admin
`POST /v1/orchestrators/{id}/api-keys` (or orchestrator
`POST /v1/orchestrators/me/api-keys`). Old coworker keys are deleted, not
converted. If migrate fails on history attribution, clear or remap
`history.coworkerId` for that Hermes coworker row, then re-run.
