# Coworker Workspace Access Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let non-globally-whitelisted coworkers be usable in chat and tasks for selected personal/org workspaces via `CoworkerWorkspaceAccess`, without overloading `VendorGrant`.

**Architecture:** New Prisma model + status machine parallel to `VendorGrant`. Central Core helpers decide human-side usability (`isWhitelisted OR GRANTED access`). Grant write rules: platform direct; vendor admin direct on member workspaces; vendor admin foreign → PENDING accept. Web mirrors vendor-grant services/settings and switches pickers to workspace `available` catalog.

**Tech Stack:** Prisma/Postgres, Hono OpenAPI Core, Vitest, Next.js web + generated Core client, next-intl.

**Spec:** `docs/superpowers/specs/2026-08-05-coworker-workspace-access-design.md`

## Global Constraints

- Do **not** overload `VendorGrant` or change task `GRANT_PENDING` / vendor-grant parking
- Global `Coworker.isWhitelisted` still means usable in **all** workspaces
- Access is all-or-nothing (no per-capability access rows); coworker `capabilities[]` and chat `baseURL` still apply
- Terminal `DENIED` / `REVOKED`: vendor cannot re-open; platform admin may force `GRANTED`
- Human pick/assign/chat-add/list: workspace-aware usability
- Coworker **actor** capability checks (`requireCoworkerCapability` for API-key routes): require active + capability (+ baseURL for chat) **without** global whitelist so pilot API keys work once humans can pick them
- Web never imports `@sokosumi/database` / Prisma; regenerate Core client after OpenAPI changes
- Pin no new deps; Biome format; Conventional Commits
- Copy: “Coworker early access” vs “Vendor workspace access”

## File map

| File | Responsibility |
|------|----------------|
| `packages/database/prisma/schema.prisma` | Enum + `CoworkerWorkspaceAccess` + relations |
| `packages/database/prisma/migrations/<ts>_add_coworker_workspace_access/` | Migration |
| `apps/core/src/helpers/coworker-workspace-access.ts` | Create/propose/approve/deny/revoke + notify |
| `apps/core/src/helpers/coworker-workspace-access.test.ts` | Helper unit tests |
| `apps/core/src/schemas/coworker-workspace-access.schema.ts` | Zod/OpenAPI DTO |
| `apps/core/src/helpers/access-control.ts` | Workspace-aware human usability; actor without whitelist |
| `apps/core/src/helpers/access-control.test.ts` | Usability matrix tests |
| `apps/core/src/helpers/coworker-queries.ts` | Chat-by-slug workspace-aware if still used |
| `apps/core/src/routes/v1/chats/rooms/helpers.ts` | `validateChatCoworkerIds(workspaceId, …)` |
| `apps/core/src/services/chat-room-coworker-dispatch.service.ts` | Dispatch usability re-check |
| `apps/core/src/routes/v1/coworkers/[id]/workspace-access/*` | POST/GET grantor APIs |
| `apps/core/src/routes/v1/users/[id]/coworker-access/*` | List + approve/deny/revoke personal |
| `apps/core/src/routes/v1/organizations/[id]/coworker-access/*` | List + approve/deny/revoke org |
| `apps/core/src/routes/v1/coworkers/get.ts` | `scope=available` + workspace context |
| `apps/core/src/routes/v1/tasks/post.ts` / `patch.ts` | Pass workspaceId into assignable check |
| `apps/web` services/actions/settings/admin/developer + pickers | UI + client regenerate |

---

### Task 1: Prisma schema + migration

**Files:**
- Modify: `packages/database/prisma/schema.prisma`
- Create: `packages/database/prisma/migrations/YYYYMMDDHHMMSS_add_coworker_workspace_access/migration.sql` (via migrate)

**Interfaces:**
- Produces: `CoworkerWorkspaceAccessStatus`, `CoworkerWorkspaceAccess` model; relations on `Coworker`, `Workspace`, `User`

- [ ] **Step 1: Add enum + model to schema**

Add near `VendorGrant` (keep naming parallel):

```prisma
enum CoworkerWorkspaceAccessStatus {
  PENDING
  GRANTED
  DENIED
  REVOKED
}

/// Human-side early access: coworker usable in this workspace without global whitelist.
model CoworkerWorkspaceAccess {
  id        String   @id @default(uuid(7)) @db.Uuid
  createdAt DateTime @default(now())
  updatedAt DateTime @updatedAt

  coworkerId String
  coworker   Coworker @relation(fields: [coworkerId], references: [id], onDelete: Cascade)

  workspaceId String    @db.Uuid
  workspace   Workspace @relation(fields: [workspaceId], references: [id], onDelete: Cascade)

  status CoworkerWorkspaceAccessStatus @default(PENDING)

  requestedByUserId String?
  requestedBy       User?   @relation("CoworkerWorkspaceAccessRequestedBy", fields: [requestedByUserId], references: [id], onDelete: SetNull)

  resolvedAt   DateTime?
  resolvedById String?
  resolvedBy   User?     @relation("CoworkerWorkspaceAccessResolvedBy", fields: [resolvedById], references: [id], onDelete: SetNull)

  @@unique([coworkerId, workspaceId])
  @@index([workspaceId, status])
  @@index([coworkerId, status])
  @@map("coworker_workspace_access")
}
```

Wire reverse relations on `Coworker`, `Workspace`, and `User` (two named relations for requested/resolved).

- [ ] **Step 2: Create migration and generate client**

```bash
pnpm prisma:migrate:dev --name add_coworker_workspace_access
pnpm prisma:generate
```

Expected: migration applies; client exports `CoworkerWorkspaceAccessStatus` and model delegate.

- [ ] **Step 3: Commit**

```bash
git add packages/database/prisma
git commit -m "feat(database): add coworker workspace access model"
```

---

### Task 2: Core access write helpers (TDD)

**Files:**
- Create: `apps/core/src/helpers/coworker-workspace-access.ts`
- Create: `apps/core/src/helpers/coworker-workspace-access.test.ts`
- Create: `apps/core/src/schemas/coworker-workspace-access.schema.ts`

**Interfaces:**
- Consumes: Prisma, `requireVendorAdminMembership` / vendor membership patterns, `createNotification`, workspace + member lookups
- Produces:
  - `toCoworkerWorkspaceAccessApiShape(row): CoworkerWorkspaceAccessDto`
  - `isCoworkerAccessTerminal(status): boolean`
  - `userBelongsToWorkspace(userId, workspaceId, tx?): Promise<boolean>`
  - `upsertCoworkerWorkspaceAccess(params, tx): Promise<AccessRow>`
  - `approveCoworkerWorkspaceAccess` / `denyCoworkerWorkspaceAccess` / `revokeCoworkerWorkspaceAccess`
  - `notifyWorkspaceApproversOfPendingCoworkerAccess`
  - `listCoworkerAccessForWorkspace(workspaceId, tx?)`

**`upsertCoworkerWorkspaceAccess` params:**

```typescript
interface UpsertCoworkerWorkspaceAccessParams {
  coworkerId: string;
  workspaceId: string;
  actorUserId: string;
  /** Platform admin (hasAdminRole) */
  isPlatformAdmin: boolean;
}
```

**Status resolution inside upsert (after loading coworker.vendorId + workspace + actor vendor admin membership):**

1. Workspace missing → `notFound("Workspace not found")`
2. Coworker missing/archived → `notFound("Coworker not found")`
3. If `isPlatformAdmin` → upsert to `GRANTED` (reopen terminal allowed), set `resolvedById`/`resolvedAt`/`requestedByUserId`
4. Else require vendor admin on `coworker.vendorId` → else `forbidden`
5. If `userBelongsToWorkspace(actor, workspace)` → upsert `GRANTED`
6. Else if existing status terminal → `badRequest` / conflict “Cannot re-request after deny/revoke”
7. Else upsert `PENDING`, `requestedByUserId = actor`, clear resolved fields if recreating from missing only
8. Idempotent: existing `PENDING` or `GRANTED` → return as-is (platform may upgrade PENDING→GRANTED)

Approve: only `PENDING` → `GRANTED`. Deny: only `PENDING` → `DENIED`. Revoke: only `GRANTED` → `REVOKED`. Wrong status → `badRequest`.

- [ ] **Step 1: Write failing unit tests**

Cover at least:

- platform → always GRANTED (including reopen DENIED)
- vendor admin + member workspace → GRANTED
- vendor admin + foreign → PENDING
- non-admin / wrong vendor → forbidden
- terminal re-request by vendor → error
- approve/deny/revoke happy + wrong status
- `userBelongsToWorkspace` personal vs org member

Mock Prisma like `vendor-grants.test.ts`.

- [ ] **Step 2: Run tests — expect FAIL**

```bash
pnpm --filter core test src/helpers/coworker-workspace-access.test.ts
```

- [ ] **Step 3: Implement helpers + Zod schema**

Schema fields: `id`, `createdAt`, `updatedAt`, `coworkerId`, `workspaceId`, `status`, `requestedByUserId`, `resolvedAt`, `resolvedById` (mirror vendor grant DTO style).

Notify pending using `NotificationKind.SYSTEM`, `messageKey: "notifications.coworkerAccess.pending"`, metadata `{ coworkerId, workspaceId, organizationId }`, recipients = personal workspace user or org OWNER/ADMIN (copy `notifyWorkspaceApproversOfPendingGrant`).

Call notify **after** successful PENDING create (best-effort; do not fail request if notify fails — match vendor-grant post-commit pattern if present, else same transaction as vendor grants).

- [ ] **Step 4: Run tests — expect PASS**

- [ ] **Step 5: Commit**

```bash
git add apps/core/src/helpers/coworker-workspace-access.ts apps/core/src/helpers/coworker-workspace-access.test.ts apps/core/src/schemas/coworker-workspace-access.schema.ts
git commit -m "feat(core): coworker workspace access write helpers"
```

---

### Task 3: Human usability helpers (workspace-aware)

**Files:**
- Modify: `apps/core/src/helpers/access-control.ts`
- Modify: `apps/core/src/helpers/access-control.test.ts`
- Modify: `apps/core/src/helpers/coworker-queries.ts` (if still used for human chat)

**Interfaces:**
- Produces (signatures):

```typescript
export function buildCoworkerUsableInWorkspaceWhere(
  workspaceId: string,
): Prisma.CoworkerWhereInput;

export async function findUsableCoworkerByCapabilityInWorkspace(
  coworkerId: string,
  workspaceId: string,
  capability: CoworkerCapability,
  tx?: Prisma.TransactionClient,
  options?: { requireBaseUrl?: boolean },
): Promise<{ id: string; slug: string; baseURL: string | null } | null>;

export async function requireTaskAssignableCoworker(
  coworkerId: string,
  workspaceId: string,
  tx?: Prisma.TransactionClient,
): Promise<void>;

export async function requireCoworkerChatCapabilityInWorkspace(
  coworkerId: string,
  workspaceId: string,
  tx?: Prisma.TransactionClient,
): Promise<{ id: string; slug: string; baseURL: string | null }>;

/** Actor routes: active + capability; NO whitelist / workspace access */
export async function requireCoworkerCapability(
  coworkerId: string,
  capability: CoworkerCapability,
  tx?: Prisma.TransactionClient,
): Promise<void>;
```

**`buildCoworkerUsableInWorkspaceWhere`:**

```typescript
{
  archivedAt: null,
  OR: [
    { isWhitelisted: true },
    {
      workspaceAccess: {
        some: { workspaceId, status: "GRANTED" },
      },
    },
  ],
}
```

(Use relation name chosen in schema, e.g. `workspaceAccess` / `coworkerWorkspaceAccess`.)

- [ ] **Step 1: Update failing tests in `access-control.test.ts`**

- `requireTaskAssignableCoworker` now requires `workspaceId`
- Pass when `isWhitelisted` without access row
- Pass when not whitelisted but GRANTED access for that workspace
- Fail when PENDING / DENIED / REVOKED / wrong workspace / archived / missing tasks capability
- `requireCoworkerCapability` (actor): passes for non-whitelisted active coworker with capability

- [ ] **Step 2: Run tests — expect FAIL**

```bash
pnpm --filter core test src/helpers/access-control.test.ts
```

- [ ] **Step 3: Implement**

- Refactor private finder for **human** paths to use workspace OR whitelist
- Change `requireTaskAssignableCoworker` signature to require `workspaceId`
- Add `requireCoworkerChatCapabilityInWorkspace`
- Change actor `requireCoworkerCapability` / actor-only chat helper to **drop** `isWhitelisted: true` (capability + `archivedAt: null` only; chat still needs baseURL)

Keep a deprecated alias only if compile breaks mid-branch; prefer fix all call sites in Tasks 4–6 in same PR stack.

- [ ] **Step 4: Run tests — PASS**

- [ ] **Step 5: Commit**

```bash
git commit -am "feat(core): workspace-aware coworker usability helpers"
```

---

### Task 4: Grantor APIs — POST/GET `/v1/coworkers/{id}/workspace-access`

**Files:**
- Create: `apps/core/src/routes/v1/coworkers/[id]/workspace-access/post.ts`
- Create: `apps/core/src/routes/v1/coworkers/[id]/workspace-access/get.ts`
- Create: `apps/core/src/routes/v1/coworkers/[id]/workspace-access/post.test.ts` (and get test)
- Modify: coworker `[id]` route index to mount

**Interfaces:**
- `POST` body: `{ workspaceId: string (uuid) }`
- `POST` auth: user session; uses `hasAdminRole` + vendor admin checks inside helper
- `GET` auth: platform admin OR vendor admin for coworker’s vendor
- Response: access DTO (POST 201, GET 200 array)

- [ ] **Step 1: Write route tests**

Cases:

- platform admin → 201 GRANTED
- vendor admin member workspace → 201 GRANTED
- vendor admin foreign → 201 PENDING
- random user → 403
- missing workspace → 404

- [ ] **Step 2: Run — FAIL**

```bash
pnpm --filter core test src/routes/v1/coworkers/
```

- [ ] **Step 3: Implement routes + mount**

- [ ] **Step 4: Run — PASS**

- [ ] **Step 5: Commit**

```bash
git commit -am "feat(core): coworker workspace-access grantor routes"
```

---

### Task 5: Workspace owner APIs — user + org coworker-access

**Files:**
- Create under `apps/core/src/routes/v1/users/[id]/coworker-access/` — `get.ts`, `[accessId]/approve/post.ts`, `deny/post.ts`, `revoke/post.ts` + tests
- Create under `apps/core/src/routes/v1/organizations/[id]/coworker-access/` — same shape + tests
- Modify: user/org route indexes to mount

**Auth:**

- Personal: `requireOwnerUserContext` + resolved self (same as vendor-grants user routes)
- Org: owner/admin for mutations and list (match vendor-grant org mutations)

Load access by id; verify `access.workspaceId` matches personal/org workspace before transition.

- [ ] **Step 1: Write failing route tests** (approve pending; deny; revoke; wrong user 403; wrong workspace 404)

- [ ] **Step 2: Run — FAIL**

- [ ] **Step 3: Implement** (thin routes calling Task 2 helpers)

- [ ] **Step 4: Run — PASS**

- [ ] **Step 5: Commit**

```bash
git commit -am "feat(core): user and org coworker-access approve deny revoke"
```

---

### Task 6: Wire tasks assign + catalog `available`

**Files:**
- Modify: `apps/core/src/routes/v1/tasks/post.ts` — pass active workspace id into `requireTaskAssignableCoworker`
- Modify: `apps/core/src/routes/v1/tasks/[id]/patch.ts` — same for assignee changes
- Modify: `apps/core/src/routes/v1/tasks/whitelist-enforcement.test.ts` + post/patch tests for new arity
- Modify: `apps/core/src/routes/v1/coworkers/get.ts` — add `scope=available`
- Modify: `apps/core/src/routes/v1/coworkers/get.test.ts`

**Catalog `scope=available`:**

- Requires user auth + resolvable workspace from auth context (same workspace resolution as other user routes: active org workspace or personal)
- Where: `archivedAt: null` + `buildCoworkerUsableInWorkspaceWhere(workspaceId)` + optional capability filter
- Default stays `whitelisted` for backward compatibility; web switches later

**Task create/patch:** use `c.var.workspaceContext` / existing workspace helper already used on those routes.

- [ ] **Step 1: Update tests for new `requireTaskAssignableCoworker` call shape and available scope**

- [ ] **Step 2: Implement wiring**

- [ ] **Step 3: Run**

```bash
pnpm --filter core test src/routes/v1/tasks/ src/routes/v1/coworkers/get.test.ts src/helpers/access-control.test.ts
```

- [ ] **Step 4: Commit**

```bash
git commit -am "feat(core): workspace-aware task assign and available catalog"
```

---

### Task 7: Wire chat validate, stream, dispatch

**Files:**
- Modify: `apps/core/src/routes/v1/chats/rooms/helpers.ts` — `validateChatCoworkerIds(coworkerIds, workspaceId, tx)`
- Modify: `apps/core/src/routes/v1/chats/rooms/post.ts` — resolve workspace, pass id
- Modify: `apps/core/src/routes/v1/chats/rooms/[id]/patch.ts` — same
- Modify: `apps/core/src/routes/v1/chats/rooms/[id]/stream/post.ts` — `requireCoworkerChatCapabilityInWorkspace`
- Modify: `apps/core/src/services/chat-room-coworker-dispatch.service.ts` — replace bare `isWhitelisted` check with workspace usability for sender/room workspace
- Modify related tests

**Workspace resolution (from spec):**

```typescript
async function resolveWorkspaceIdForChatRoom(params: {
  organizationId: string | null;
  /** personal rooms: human actor / message sender */
  personalUserId: string;
  tx?: Prisma.TransactionClient;
}): Promise<string> {
  if (params.organizationId) {
    const ws = await tx.workspace.findUnique({
      where: { organizationId: params.organizationId },
      select: { id: true },
    });
    if (!ws) throw badRequest("Organization workspace not found");
    return ws.id;
  }
  const ws = await tx.workspace.findUnique({
    where: { userId: params.personalUserId },
    select: { id: true },
  });
  if (!ws) throw badRequest("Personal workspace not found");
  return ws.id;
}
```

Dispatch: load room org + message sender; resolve workspace; if not usable for `chat`, `markMentionFailed(..., "Coworker chat is not available")`.

- [ ] **Step 1: Failing tests** — non-whitelisted + GRANTED allowed; non-whitelisted without access rejected; whitelist still allowed

- [ ] **Step 2: Implement**

- [ ] **Step 3: Run**

```bash
pnpm --filter core test src/routes/v1/chats/ src/services/chat-room-coworker-dispatch.service.test.ts
```

- [ ] **Step 4: Grep audit**

```bash
rg -n "isWhitelisted:\\s*true" apps/core/src --type ts
```

Every remaining hit must be intentional (admin list, pure `scope=whitelisted`, actor-free display). Fix stragglers that gate human use.

- [ ] **Step 5: Commit**

```bash
git commit -am "feat(core): workspace-aware coworker chat usability"
```

---

### Task 8: Notifications copy (Core + web messages)

**Files:**
- Already partially in Task 2 helper
- Modify: `apps/web/messages/en.json` (+ other locales per project rule) for:
  - `notifications.coworkerAccess.pending`
  - settings/admin labels for “Coworker early access”
- Modify: web notification utils if vendor-grant has a parallel detector (`isPendingVendorGrantNotification`) → add coworker-access variant + actions component

- [ ] **Step 1: Add en keys; mirror locales**

- [ ] **Step 2: Wire notification actions** (approve/deny) calling new server actions once Task 9 services exist — if web not ready, Core still creates notifications; complete actions in Task 9

- [ ] **Step 3: Commit**

```bash
git commit -am "feat(web): coworker early access notification copy"
```

---

### Task 9: Web — regenerate client, service, actions, admin grant UI

**Files:**
- Run: `pnpm --filter web generate:core:snapshot`
- Create: `apps/web/src/lib/services/coworker-access.service.ts` (+ tests)
- Create: `apps/web/src/lib/actions/...` for approve/deny/revoke/create (account + org + admin/developer as needed)
- Modify: admin coworker form/detail — grant by workspace id (or org slug / user email resolved server-side if helpers exist; else workspace UUID input v1)

**Service methods:**

```typescript
listForPersonalWorkspace(): Promise<AccessDto[]>
listForOrganization(organizationId: string): Promise<AccessDto[]>
approve/deny/revoke(accessId, scope)
createForCoworker(coworkerId, workspaceId) // platform or vendor
listForCoworker(coworkerId)
```

- [ ] **Step 1: Regenerate client; typecheck web against new operations**

```bash
pnpm --filter web generate:core:snapshot
pnpm --filter web typecheck
```

- [ ] **Step 2: Service + actions + admin UI minimal direct grant**

- [ ] **Step 3: Tests for service mapping**

- [ ] **Step 4: Commit**

```bash
git commit -am "feat(web): coworker early access service and admin grant"
```

---

### Task 10: Web — account/org accept UI + vendor dogfood UI + pickers

**Files:**
- Modify: `apps/web/src/app/(app)/account/components/` — section parallel to `account-vendor-grants`
- Modify: org settings — parallel vendor grants section
- Modify: developer/vendor coworker UI — enable / propose / list access
- Modify: coworker list/pickers (task assignee, chat mention) to use `scope=available` with workspace context instead of default whitelisted
- Notification action component for pending coworker access

- [ ] **Step 1: Account + org list with Approve / Deny / Revoke**

- [ ] **Step 2: Vendor enable UI (member workspace direct; foreign workspaceId → pending)**

- [ ] **Step 3: Switch product pickers to `available`**

Search:

```bash
rg -n "scope.*whitelisted|listCoworkers|getCoworkers" apps/web/src --type ts --type tsx
```

Update end-user catalog callers; leave admin/developer `owned`/`all` as-is.

- [ ] **Step 4: Manual sanity / unit tests for actions**

- [ ] **Step 5: Commit**

```bash
git commit -am "feat(web): coworker early access settings vendor and pickers"
```

---

### Task 11: Docs + final verification

**Files:**
- Create: `docs/coworker/coworker-workspace-access-api.md` (integrator/admin oriented; link from AGENTS domain docs if needed)
- Modify: `docs/coworker/vendor-workspace-grants-api.md` — short “Related: not the same as coworker early access” note

- [ ] **Step 1: Write API doc** (status matrix, endpoints, usability rule, vs VendorGrant)

- [ ] **Step 2: Full targeted test + typecheck**

```bash
pnpm --filter core test src/helpers/coworker-workspace-access.test.ts src/helpers/access-control.test.ts
pnpm --filter core test src/routes/v1/coworkers/ src/routes/v1/tasks/whitelist-enforcement.test.ts
pnpm --filter core test src/routes/v1/chats/ src/services/chat-room-coworker-dispatch.service.test.ts
pnpm --filter web typecheck
pnpm --filter core typecheck
```

- [ ] **Step 3: Commit**

```bash
git commit -am "docs(coworker): workspace early access API guide"
```

---

## Spec coverage checklist

| Spec requirement | Task |
|------------------|------|
| `CoworkerWorkspaceAccess` model + statuses | 1 |
| Platform direct GRANTED | 2, 4 |
| Vendor member direct GRANTED | 2, 4 |
| Vendor foreign PENDING | 2, 4 |
| Owner accept/deny/revoke | 2, 5, 10 |
| Terminal no vendor reopen; platform force | 2 |
| Usability rule chat + tasks | 3, 6, 7 |
| Catalog available | 6, 10 |
| Grantor + owner APIs | 4, 5 |
| Notifications | 2, 8, 10 |
| Web admin / settings / vendor / pickers | 9, 10 |
| VendorGrant unchanged | Global + 11 |
| Actor capability without whitelist | 3 |
| Success criteria tests | 2, 3, 6, 7, 11 |

## Self-review notes

- No TBD placeholders; signatures named for implementers
- Actor vs human whitelist split is required for end-to-end pilot (called out in Global Constraints + Task 3); aligns with success criterion “usable in chat and tasks”
- Relation field name on Coworker must match schema choice in Task 1 (`workspaceAccess` recommended)
