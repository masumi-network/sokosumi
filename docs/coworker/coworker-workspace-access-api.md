# Coworker API: workspace early access

Guide for **platform / vendor / workspace admins** using the Sokosumi Core API
(`apps/core`) to make non-globally-whitelisted coworkers usable in **chat and
tasks** for specific personal or organization workspaces.

Product name: **Coworker early access**. This is **not** vendor task access —
see [Vendor workspace grants](./vendor-workspace-grants-api.md).

- **Source of truth (behavior):**
  `apps/core/src/helpers/coworker-workspace-access.ts`,
  `apps/core/src/helpers/access-control.ts`
  (`buildCoworkerUsableInWorkspaceWhere`,
  `findUsableCoworkerByCapabilityInWorkspace`)
- **Source of truth (OpenAPI shape):**
  `apps/core/src/schemas/coworker-workspace-access.schema.ts`
  (includes `coworkerName` / `coworkerSlug` on every access DTO — same pattern as
  vendor grants)
- **Design:**
  [`docs/superpowers/specs/2026-08-05-coworker-workspace-access-design.md`](../superpowers/specs/2026-08-05-coworker-workspace-access-design.md)

---

## Concepts kept separate

| Concept | Model | Meaning |
| --- | --- | --- |
| Public marketplace | `Coworker.isWhitelisted` | Usable in **every** workspace (no access row required) |
| Pre-whitelist / pilot | `CoworkerWorkspaceAccess` | Usable in **this** workspace when `status = GRANTED` |
| Vendor acts on tasks | `VendorGrant` | Unchanged; baseline / `GRANT_PENDING` / delegated create |

Access is **all-or-nothing** for product surfaces (chat + tasks). Coworker
`capabilities[]` and chat `baseURL` still apply. No per-capability access rows.

**Coworker API-key actor** paths do **not** require whitelist or a workspace
access row: actor auth needs active coworker + capability (+ `baseURL` for
chat). Access rows govern **human-side** pick/use in a workspace.

---

## Status matrix

| Status | Meaning | Human usable in that workspace? |
| --- | --- | --- |
| *(no row)* | Never proposed / granted | No (unless globally whitelisted) |
| `PENDING` | Vendor proposed foreign workspace; awaiting owner | No |
| `GRANTED` | Pilot enabled for this workspace | **Yes** (with capability rules) |
| `DENIED` | Owner denied | No — **terminal** for foreign vendor propose only |
| `REVOKED` | Owner revoked a prior grant | No — **terminal** for foreign vendor propose only |

**Terminal reopen (v1)** — who may force `GRANTED` on `DENIED` / `REVOKED`
via the create path (`POST …/workspace-access`):

| Actor | Terminal `DENIED` / `REVOKED` |
| --- | --- |
| Platform admin | May force `GRANTED` (reopen) |
| Vendor admin + belongs to workspace | May force `GRANTED` via direct enable (reopen) |
| Vendor admin + foreign workspace | Cannot re-request; `400` until platform or member path |
| Workspace owner | Can deny/revoke; does **not** force reopen |

Only **foreign** propose is terminal. Direct enable (platform, or vendor admin
who belongs to the workspace) reopens the same row to `GRANTED`.

**Idempotency:** duplicate create for the same `(coworkerId, workspaceId)`
returns the existing row when status is already `PENDING` or `GRANTED`.

---

## Usability rule (single source of truth)

Human pick/use in a workspace (task assign, chat membership, mention dispatch,
catalog `scope=available`):

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

Helpers:

- `buildCoworkerUsableInWorkspaceWhere(workspaceId)` — list filters
- `findUsableCoworkerByCapabilityInWorkspace` — assign / chat validate

### Chat workspace resolution

| Room | Workspace used for usability |
| --- | --- |
| Has `organizationId` | That org’s unique workspace |
| Personal (no org) | Acting user’s personal workspace (membership validate / catalog); for mention dispatch, **message sender’s** personal workspace |

Personal rooms are not multi-tenant: pilot grants on user A’s personal
workspace do not leak into user B’s personal chat.

---

## Write rules

| Actor | Action | Result |
| --- | --- | --- |
| Platform admin | `POST …/workspace-access` any coworker × any workspace | Immediate `GRANTED` (reopens terminal) |
| Vendor admin (own-vendor coworker) × workspace they **belong to** | Same create path | Immediate `GRANTED` (reopens terminal) |
| Vendor admin (own-vendor coworker) × **foreign** workspace | Same create path | Upsert `PENDING` if not terminal; `400` if `DENIED` / `REVOKED` |
| Workspace owner / org owner-admin | Approve / deny / revoke on their workspace | `PENDING` → `GRANTED` or `DENIED`; `GRANTED` → `REVOKED` (no force reopen) |
| Anyone else | — | `403` |

**Belonging to a workspace** (vendor direct grant eligibility):

- **Personal:** `workspace.userId === actorUserId`
- **Org:** actor has an active organization membership for
  `workspace.organizationId`

---

## Resource shape

```json
{
  "id": "uuid",
  "coworkerId": "uuid",
  "workspaceId": "uuid",
  "status": "PENDING | GRANTED | DENIED | REVOKED",
  "requestedByUserId": "string | null",
  "resolvedAt": "ISO-8601 | null",
  "resolvedById": "string | null",
  "createdAt": "ISO-8601",
  "updatedAt": "ISO-8601"
}
```

Unique on `(coworkerId, workspaceId)`.

---

## Endpoint reference

### Propose / direct grant (grantor side)

| Method | Route | Auth | Behavior |
| --- | --- | --- | --- |
| `POST` | `/v1/coworkers/{id}/workspace-access` | User session; platform admin **or** vendor admin for coworker’s vendor | Body: `{ "workspaceId": "<uuid>" }`. Status from write rules. `201` + access DTO. |
| `GET` | `/v1/coworkers/{id}/workspace-access` | Platform admin **or** vendor admin for coworker’s vendor | List access rows for that coworker (newest first). |

### Workspace owner side

| Method | Route | Auth | Behavior |
| --- | --- | --- | --- |
| `GET` | `/v1/users/{id}/coworker-access` | Personal workspace owner (self) | List access rows for user’s personal workspace |
| `POST` | `/v1/users/{id}/coworker-access/{accessId}/approve` | Owner (self) | `PENDING` → `GRANTED` |
| `POST` | `/v1/users/{id}/coworker-access/{accessId}/deny` | Owner (self) | `PENDING` → `DENIED` |
| `POST` | `/v1/users/{id}/coworker-access/{accessId}/revoke` | Owner (self) | `GRANTED` → `REVOKED` |
| `GET` | `/v1/organizations/{id}/coworker-access` | Org owner/admin | List for org workspace |
| `POST` | `/v1/organizations/{id}/coworker-access/{accessId}/approve` | Org owner/admin | `PENDING` → `GRANTED` |
| `POST` | `/v1/organizations/{id}/coworker-access/{accessId}/deny` | Org owner/admin | `PENDING` → `DENIED` |
| `POST` | `/v1/organizations/{id}/coworker-access/{accessId}/revoke` | Org owner/admin | `GRANTED` → `REVOKED` |

List is owner/admin only (v1). Mutations use the same ownership bar as vendor-grant admin routes.

### Catalog (product pickers)

| Query | Meaning |
| --- | --- |
| `GET /v1/coworkers?scope=whitelisted` | Global whitelist only (default; marketplace) |
| `GET /v1/coworkers?scope=owned` | Vendor/assignment management (unchanged) |
| `GET /v1/coworkers?scope=available` | Usable in **active workspace**: whitelist **or** `GRANTED` access. Requires user auth + workspace context. |

Web task assignee and chat pickers use `scope=available`.

Optional `capability` query still filters (`tasks`, `chat`, …).

---

## Errors

| Case | HTTP | Notes |
| --- | --- | --- |
| Missing / archived coworker | `404` | Create path |
| Unknown workspace | `404` | Create path |
| Not platform/vendor admin (or not own vendor) | `403` | Create / list on coworker |
| Foreign vendor propose after `DENIED` / `REVOKED` | `400` | `"Cannot re-request after deny/revoke"` (member direct enable still reopens) |
| Approve/deny non-`PENDING` | `400` | |
| Revoke non-`GRANTED` | `400` | |
| Use non-usable coworker (assign / chat add) | `403` or `404` | Same helpers as pre-feature whitelist gates |
| `scope=available` without user auth or workspace context | `403` | Catalog |

---

## Notifications (v1)

| Event | Who is notified |
| --- | --- |
| New `PENDING` propose | Workspace owner (personal) or org owner/admins — best-effort `NotificationKind.SYSTEM`, message key `notifications.coworkerAccess.pending` |
| Platform / vendor direct `GRANTED` | No required notification |
| Accept / deny / revoke | No Core notify to `requestedByUserId` in v1 (settings / list API is source of truth) |

### Platform force-revoke

```text
POST /v1/coworkers/{id}/workspace-access/revoke
  body: { workspaceId }
  auth: platform admin only
```

Force-sets `GRANTED` → `REVOKED` for that pair (ops undo of a pilot grant without workspace owner).

---

## Web surfaces (summary)

| Actor | UI |
| --- | --- |
| End user | Pickers show available-for-workspace coworkers only |
| Workspace owner/admin | Account / org settings: coworker early access list; approve / deny / revoke |
| Vendor admin | Vendor coworker surface: enable for member workspace; propose foreign; list statuses |
| Platform admin | Admin coworker detail: direct grant **and force-revoke** by workspace; global whitelist toggle unchanged |

---

## Related: not VendorGrant

| | Coworker early access | Vendor workspace grant |
| --- | --- | --- |
| Model | `CoworkerWorkspaceAccess` | `VendorGrant` |
| Axis | **Coworker × workspace** human catalog/use | **Vendor × workspace** coworker actor task access |
| Effect | Non-whitelisted coworker assignable / chat-usable in that workspace | Read/list/comment/create beyond baseline; may park tasks as `GRANT_PENDING` |
| Who requests | Platform or vendor admin | Coworker actor (implicit) or human admin |
| Guide | This doc | [vendor-workspace-grants-api.md](./vendor-workspace-grants-api.md) |

Do **not** overload `VendorGrant` for human catalog availability. Global
`isWhitelisted` still opens **all** workspaces without an access row.

---

## Related docs

- [Vendor workspace grants](./vendor-workspace-grants-api.md) — task-side vendor access
- [Design spec](../superpowers/specs/2026-08-05-coworker-workspace-access-design.md)
- [Core AGENTS.md](../../apps/core/AGENTS.md) — route patterns and auth
