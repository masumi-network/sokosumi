# Coworker workspace access (pre-whitelist) design

**Date:** 2026-08-05  
**Status:** Approved for implementation  
**Context:** Make selected coworkers usable in chat and tasks for specific workspaces before global marketplace whitelist.

## Goal

Enable **customer pilots**, **vendor dogfood**, and optional **platform internal** use of non-globally-whitelisted coworkers in **chat and tasks**, scoped to personal or organization workspaces, without flipping `Coworker.isWhitelisted` for the whole platform.

## Non-goals

- Overloading `VendorGrant` (vendor-as-actor on tasks) for human catalog availability
- Per-capability access rows (chat-only / tasks-only) — coworker `capabilities[]` still apply globally on the coworker
- Auto-seed rows for Serviceplan or similar public coworkers (use global whitelist or explicit grants)
- End-user “request access” from the catalog
- Changing coworker API-key actor auth or task baseline / `GRANT_PENDING` parking rules
- Capability to reopen `DENIED` / `REVOKED` via vendor re-request without platform (v1: platform reopen only)

## Problem

Today `Coworker.isWhitelisted` is a **global** hard gate for:

- Default catalog (`GET /v1/coworkers?scope=whitelisted`)
- Task assignability (`requireTaskAssignableCoworker` → `findUsableCoworkerByCapability`)
- Chat room membership validation and mention dispatch

There is no per-workspace exception. `VendorGrant` is a different axis (vendor may act on tasks in a workspace) and must stay separate.

## Decisions

| Topic | Choice |
| --- | --- |
| Audience | Customer pilot + vendor dogfood (+ optional internal via platform) |
| Surfaces (v1) | Chat **and** tasks |
| Approach | Dedicated `CoworkerWorkspaceAccess` table (Approach 1) |
| Global whitelist | Unchanged = usable in **all** workspaces |
| Platform admin | **Direct** grant to any workspace (`GRANTED` immediately) |
| Vendor admin (own coworkers) × workspace they **belong to** | **Direct** `GRANTED` |
| Vendor admin (own coworkers) × **foreign** workspace | **PENDING** → workspace owner/admin accept/deny |
| Workspace owner/admin | Accept / deny / revoke for their workspace |
| Terminal statuses | `DENIED` / `REVOKED` terminal for normal vendor flows; platform may force reopen |

## Domain model

### Concepts kept separate

| Concept | Model | Meaning |
| --- | --- | --- |
| Public marketplace | `Coworker.isWhitelisted` | Usable in every workspace |
| Pre-whitelist availability | `CoworkerWorkspaceAccess` (new) | Usable in **this** workspace when `status = GRANTED` |
| Vendor acts on tasks | `VendorGrant` | Unchanged |

### Schema

```text
enum CoworkerWorkspaceAccessStatus {
  PENDING
  GRANTED
  DENIED
  REVOKED
}

model CoworkerWorkspaceAccess {
  id                String   @id @default(uuid(7)) @db.Uuid
  createdAt         DateTime @default(now())
  updatedAt         DateTime @updatedAt

  coworkerId        String
  coworker          Coworker @relation(...)

  workspaceId       String   @db.Uuid
  workspace         Workspace @relation(...)

  status            CoworkerWorkspaceAccessStatus @default(PENDING)

  requestedByUserId String?
  requestedBy       User?  @relation(...)

  resolvedAt        DateTime?
  resolvedById      String?
  resolvedBy        User?  @relation(...)

  @@unique([coworkerId, workspaceId])
  @@index([workspaceId, status])
  @@index([coworkerId, status])
  @@map("coworker_workspace_access")
}
```

No `permission` column: access is all-or-nothing for product surfaces; existing `capabilities[]` (and chat `baseURL`) still required.

### Belonging to a workspace

Used for vendor **direct** grant eligibility:

- **Personal workspace:** `workspace.userId === actorUserId`
- **Org workspace:** actor has an active organization membership for `workspace.organizationId`

### Usability rule (single source of truth)

```text
isCoworkerUsableInWorkspace(coworker, workspace, capability):
  coworker.archivedAt is null
  AND capability ∈ coworker.capabilities
  AND (capability === chat ⇒ baseURL present and non-empty)
  AND (
    coworker.isWhitelisted
    OR exists CoworkerWorkspaceAccess
         where coworkerId, workspaceId, status = GRANTED
  )
```

- Missing row, `PENDING`, `DENIED`, or `REVOKED` → not usable (unless globally whitelisted).
- Global whitelist does not require an access row.

### Write rules

| Actor | Action | Result |
| --- | --- | --- |
| Platform admin | Create/update for any coworker × any workspace | Immediate `GRANTED` (or force `REVOKED` / reopen) |
| Vendor admin | Own-vendor coworker × workspace they belong to | Immediate `GRANTED` |
| Vendor admin | Own-vendor coworker × foreign workspace | Upsert `PENDING` (if not terminal) |
| Workspace owner / org owner-admin | Their workspace | `PENDING` → `GRANTED` or `DENIED`; `GRANTED` → `REVOKED` |
| Anyone else | — | 403 |

**Idempotency:** duplicate create for same pair returns existing row when status already `PENDING` or `GRANTED`.

**Terminal reopen (v1):** vendor cannot re-open `DENIED` / `REVOKED` via propose; platform admin may force `GRANTED` (or equivalent admin path).

## Core enforcement

### Helper

Introduce workspace-aware helpers (names illustrative):

- `isCoworkerUsableInWorkspace` / `requireCoworkerUsableInWorkspace`
- `buildCoworkerUsableInWorkspaceWhere(workspaceId)` for list queries

Refactor:

| Call site | Change |
| --- | --- |
| `findUsableCoworkerByCapability` | Require `workspaceId`; whitelist **OR** `GRANTED` access |
| `requireTaskAssignableCoworker` | Pass task or create-target workspace |
| `requireCoworkerChatCapability` / `validateChatCoworkerIds` | Pass room-resolved workspace |
| Chat mention dispatch | Re-check usability for room workspace before stream |
| Coworker catalog for product UI | Workspace-scoped availability (see API) |

**Coworker API-key actor** paths are unchanged regarding this table: access rows govern **human-side** pick/use in a workspace. Task-side `VendorGrant` / baseline rules stay as documented in `docs/coworker/vendor-workspace-grants-api.md`.

### Chat workspace resolution

- Room with `organizationId` → that organization’s unique `Workspace`
- Room without org (personal) → acting user’s personal `Workspace` for membership validation and catalog; for mention dispatch, use the **message sender’s** personal workspace when the room is personal (fail closed if workspace missing)

Rationale: personal rooms are not multi-tenant; usability is evaluated in the human actor’s personal workspace so pilot grants on user A’s personal workspace do not leak into user B’s personal chat.

## Core HTTP API

Mirror vendor-grant route shape where practical. Prefer **one create path** with role-based initial status over many admin-only duplicates.

### Propose / direct grant

```text
POST /v1/coworkers/{id}/workspace-access
  body: { workspaceId: uuid }
```

Server applies write rules above (platform → `GRANTED`; vendor member workspace → `GRANTED`; vendor foreign → `PENDING`).

```text
GET /v1/coworkers/{id}/workspace-access
```

Vendor admin (own coworker) or platform admin: list access rows for that coworker.

### Workspace owner side

```text
GET  /v1/users/{id}/coworker-access
POST /v1/users/{id}/coworker-access/{accessId}/approve
POST /v1/users/{id}/coworker-access/{accessId}/deny
POST /v1/users/{id}/coworker-access/{accessId}/revoke

GET  /v1/organizations/{id}/coworker-access
POST /v1/organizations/{id}/coworker-access/{accessId}/approve|deny|revoke
```

**Auth (v1):**

- Mutations: personal self / org owner-admin (same bar as vendor-grant mutations)
- List: owner-admin only (reduce noise; expand later if product needs member visibility)

### Catalog

- Keep `scope=whitelisted` = global whitelist only
- Keep `scope=owned` = vendor/assignment management (unchanged)
- Add workspace-aware availability for product pickers, e.g. `scope=available` when user auth + active workspace context:

```text
not archived AND (
  isWhitelisted
  OR GRANTED CoworkerWorkspaceAccess for this workspace
)
```

Web assignee / chat pickers must use availability, not pure whitelist.

### Errors

| Case | Behavior |
| --- | --- |
| Use non-usable coworker (assign / chat add) | 403 or 404 consistent with existing helpers |
| Vendor proposes coworker not owned by their vendor | 403 |
| Propose when status is terminal `DENIED`/`REVOKED` | 400/409; platform may force reopen |
| Invalid / unknown workspace | 404 |

### Notifications (v1 minimum)

- `PENDING`: notify workspace owner/admins (reuse vendor-grant notification patterns if cheap)
- Accept/deny: notify `requestedByUserId` (best-effort)
- Platform direct `GRANTED`: no required notification

## Web UX

| Actor | UI |
| --- | --- |
| End user | Pickers show available-for-workspace coworkers only |
| Workspace owner/admin | Account / org settings: coworker access list; approve / deny / revoke; optional notification actions |
| Vendor admin | Developer/vendor coworker surface: enable for member workspace; propose to foreign workspace; list statuses |
| Platform admin | Admin coworker detail: direct grant/revoke by workspace; global whitelist toggle unchanged |

Optional v1 badge: “Early access” / “Preview” on non-whitelisted but `GRANTED` coworkers — not required.

Web uses generated Core client + services/actions only (no Prisma).

## Rollout

1. Schema + Core helpers + HTTP APIs  
2. Wire enforcement (tasks, chat validate/dispatch, catalog availability)  
3. Web admin direct grant (ops pilots without full vendor UX)  
4. Web workspace accept UI + notifications  
5. Web vendor dogfood / propose UI  

No backfill: non-whitelisted coworkers remain unusable until an access row or global whitelist.

## Success criteria

1. Non-whitelisted coworker with `GRANTED` access is assignable on tasks and usable in chat **in that workspace only**.  
2. Same coworker is not available in other workspaces’ catalogs/pickers.  
3. Vendor admin: direct `GRANTED` on member workspaces; foreign → `PENDING` until accept.  
4. Platform admin: direct `GRANTED` any workspace without accept.  
5. Global `isWhitelisted` still opens all workspaces without access rows.  
6. `VendorGrant` and task `GRANT_PENDING` behavior unchanged.  
7. Tests cover helper matrix and key route/auth paths.

## Testing (Core)

- Helper: whitelist alone; `GRANTED` alone; `PENDING`/`DENIED`/`REVOKED` fail; archived fail; missing capability / chat baseURL fail  
- Create: platform direct; vendor member direct; vendor foreign `PENDING`; outsider 403; wrong vendor coworker 403  
- Accept / deny / revoke authz  
- Task assign + chat validate + dispatch honor helper  
- Catalog availability scoped to workspace  

## Risks

| Risk | Mitigation |
| --- | --- |
| Missed call site still requires whitelist only | Central helper; repo-wide audit of `isWhitelisted`; tests on assign + dispatch |
| Vendor workspace enumeration | Propose requires known `workspaceId`; no vendor-wide workspace directory |
| UI offers coworker API rejects | Same rule for list and mutate |
| Confusion with VendorGrant | Product copy: “Coworker early access” vs “Vendor workspace access” |

## Approaches considered

1. **Dedicated `CoworkerWorkspaceAccess` (chosen)** — clear axis, status machine parallel to `VendorGrant`, orthogonal to vendor task access.  
2. **Overload `VendorGrant`** — wrong semantics (vendor vs coworker; all siblings would leak). Rejected.  
3. **Separate proposal table + granted-only table** — extra complexity; status enum is enough. Rejected.

## Follow-ups (out of scope)

- Capability-scoped access  
- Vendor-initiated reopen after deny/revoke  
- Auto-grant seeds  
- Member-visible access lists  
- Full public request-access flow  
