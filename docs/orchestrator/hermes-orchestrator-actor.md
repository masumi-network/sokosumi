# Orchestrator actor (Hermes)

First-party Sokosumi **orchestrator** identity for Hermes. Not a marketplace
coworker: no vendor, grants, whitelist, or assignee role.

Each Hermes user has **one** `Orchestrator` row — that row *is* their instance
(task/event/usage attribution **and** local assistant mirror: name, avatar seed,
personality, poll cursors). There is no global product orchestrator profile
(no image, caption, description, or slug).

## Auth

- **Service credential:** shared env secret `ORCHESTRATOR_SERVICE_TOKEN` on Core
  (configure the same value on Hermes). Bearer match → `actor: orchestrator`.
- **Not** DB-minted `orch_` API keys (removed).
- **Per-user scope:** `orchestratorId` is never implied by the secret. Resolve
  the row by user id (context headers for workspace routes, or body `userId` for
  service “act on user U” routes).

## Context headers

Same as coworkers for workspace-scoped routes:

- `X-Context-User-Id` / `X-Context-Organization-Id`

After context is validated, Core binds `orchestratorId` to that user’s **active**
(`archivedAt` null) orchestrator row when present.

## Product vs service routes

| Concern | User session | Orchestrator service token |
| --- | --- | --- |
| Hermes product chat | `/v1/hermes/*` only | **403** (use hermes user session) |
| Usage billing | — | `POST /v1/orchestrators/me/usage` body `userId` |
| Mirror purge after orch destroy | — | `POST /v1/orchestrators/me/purge` body `userId` |
| Task create / events | as user | with context user; creator = **that user’s** orchestrator |

## Access vs coworker

| Concern | Coworker | Orchestrator |
| --- | --- | --- |
| Vendor workspace grants | Required for full workspace | Skipped |
| DRAFT tasks | Hidden | Visible (user-like in workspace) |
| Status transitions | Agent table (assignee) or user table (delegated) | **DRAFT ↔ READY only** (task events); schedule put/delete may still move `QUEUED` |
| `POST /v1/tasks/{id}/jobs` | Assigned coworker | **403** (coworker only) |
| Marketplace chat / conversations | User or assigned coworker | **403** (use `/v1/hermes/*`) |
| Task assignee (`assigneeId`) | Marketplace coworker | Never the orchestrator |
| Task creator | `creator.type = "coworker"` | `creator.type = "orchestrator"` → **user’s** orchestrator row |
| Event attribution | `coworkerId` on events | `orchestratorId` on events (per-user row) |

## Service routes (`/v1/orchestrators/me/*`)

Both require orchestrator service auth and identify the user in the **body**
(same pattern):

```
POST /v1/orchestrators/me/usage
Authorization: Bearer <ORCHESTRATOR_SERVICE_TOKEN>
{ "userId", "credits", "idempotencyKey", ... }

POST /v1/orchestrators/me/purge
Authorization: Bearer <ORCHESTRATOR_SERVICE_TOKEN>
{ "userId": "…" }
```

Usage bills that user's **personal** credit buckets and attributes the usage row to **their** orchestrator (PA is user-bound; no organizationId on usage).
Purge is idempotent: deletes messages + pending connection claims, **archives**
the orchestrator (clears poll state). Does not hard-delete the row while tasks
may still reference `creatorOrchestratorId` (`onDelete: Restrict`).

**Removed:** `POST /v1/hermes/instances/{userId}/purge` (call purge above instead).

## Instance lifecycle

| Event | Behavior |
| --- | --- |
| User activates Hermes | Upsert/unarchive `Orchestrator` for `userId` |
| User destroy (`DELETE /v1/hermes/me/instance`) | Clear messages/pending; archive orchestrator |
| Hermes service purge | `POST /orchestrators/me/purge` |
| Re-activate | Unarchive same `userId` row (or create if missing) |
| Active instance | Row exists and `archivedAt IS NULL` |

Sokosumi’s local mirror is **never auto-deleted** from a bare `instance_not_found`
on GET — only explicit purge/destroy (or a verified fresh provision path).

## Deploy coordination

1. Set `ORCHESTRATOR_SERVICE_TOKEN` on Core (required for boot; min 32 chars,
   e.g. `openssl rand -hex 16`) and deploy Core with migration
   `20260721140000_per_user_orchestrator_instance`.
2. Point Hermes at the **same** secret. Switch Hermes to:
   - `Authorization: Bearer <ORCHESTRATOR_SERVICE_TOKEN>` (no DB `orch_` keys)
   - `POST /v1/orchestrators/me/usage` with body `{ userId, credits, idempotencyKey, … }`
   - `POST /v1/orchestrators/me/purge` with body `{ userId }` (replaces hermes instance purge)
3. Deploy web (admin orchestrator UI removed).

Hard cut: Core no longer accepts DB `orch_` keys. Deploy Core+token and Hermes
auth/purge cutover together (or Hermes immediately after Core).

## Migration note

Migration `20260721140000_per_user_orchestrator_instance` folds
`hermesInstance` into `orchestrator`, remaps creator/event/usage FKs from the
old global product orchestrator to per-user rows, drops `orchestrator_api_key`
and product profile columns (`slug`, `caption`, `description`, `image`).
