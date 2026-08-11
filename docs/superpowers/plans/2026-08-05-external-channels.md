# External Channels Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Org owner/admins create `discoverability: "external"` channels; org members self-join like public; outsiders join one channel as `access: "guest"` via email room invites (no org seat); guests always see pending + joined rooms under an External sidebar section.

**Architecture:** Extend `ChatRoom` discoverability with `external`, add `ChatRoomUserMember.access` (`member` | `guest`), and `ChatRoomGuestInvitation` for email invite lifecycle. Fix room access helpers so guest membership does **not** require host-org `Member`. List rooms as active-org membership ∪ guest memberships. API invites under `/v1/chats/.../invitations` (no `guest-` path prefix). Web: create/edit visibility, invite UI, External sidebar, accept/decline.

**Tech Stack:** Prisma, Hono/OpenAPI (Core), Vitest, Next.js App Router, next-intl, `@sokosumi/email`, generated Core client (`pnpm --filter web generate:core:snapshot`).

**Spec:** `docs/superpowers/specs/2026-08-05-external-channels-design.md`

## Global Constraints

- Guest = platform user, **not** host-org `Member`, **no seat** / no `ensureCanAcceptOrganizationInvitation`
- Guests only on `discoverability === "external"` channels
- Create external: org **owner/admin** only
- Invite guests: any room member with `access === "member"` who is still host-org member
- Guests: full room read/write; **cannot** invite, patch settings/roster, archive/delete
- Org side: external like public (browse + `POST .../members/me`)
- Sidebar External always visible (any active org): pending invites + joined guest rooms
- Routes: `/v1/chats/rooms/{id}/invitations`, `/v1/chats/invitations` — never org `/v1/invitations`
- Table name may keep `ChatRoomGuestInvitation`; membership field `access`
- Convert external → public/private: **block** while any guest member or pending invite exists
- Web never imports `@sokosumi/database`; after Core OpenAPI changes regenerate client then typecheck
- Pin no new deps; Biome; neverthrow where existing services use it
- TDD: failing tests first per task

## File map

| File | Responsibility |
|------|----------------|
| `packages/database/prisma/schema.prisma` | `ChatRoomUserMember.access`; `ChatRoomGuestInvitation` model + User/ChatRoom relations |
| `packages/database/prisma/migrations/<ts>_external_channels/` | SQL for access default, invitation table, indexes, partial unique pending |
| `apps/core/src/schemas/chat-room.schema.ts` | `external` in discoverability; `myAccess`; `organizationName`; invitation schemas |
| `apps/core/src/routes/v1/chats/rooms/helpers.ts` | Discoverability map; guest-aware access; joinable external; org name on map |
| `apps/core/src/routes/v1/chats/rooms/post.ts` | Create external = owner/admin; set `access: member` on seed members |
| `apps/core/src/routes/v1/chats/rooms/get.ts` | List union active-org ∪ guest rooms; DTO fields |
| `apps/core/src/routes/v1/chats/rooms/discoverable/get.ts` | Include `external` |
| `apps/core/src/routes/v1/chats/rooms/[id]/members/me/post.ts` | Self-join public **or** external |
| `apps/core/src/routes/v1/chats/rooms/[id]/patch.ts` | Block discoverability change with guests/pending; guests cannot patch |
| `apps/core/src/routes/v1/chats/rooms/[id]/invitations/*.ts` | Host create/list/revoke room invitations |
| `apps/core/src/routes/v1/chats/invitations/*.ts` | Invitee list pending / get / accept / decline |
| `apps/core/src/routes/v1/chats/index.ts` | Mount invitations router **before** or beside rooms |
| `apps/core/src/helpers/chat-room-invitation.ts` | Lookup/normalize email/status helpers (mirror org invitation style) |
| `packages/email` | `renderChatRoomInvitationEmail` + locales |
| `apps/web` create/edit channel, sidebar, invite UI, `/chat/invites/[id]` | Product surface |
| Generated Core client | After OpenAPI stabilizes |

---

### Task 1: Schema — `access` + `ChatRoomGuestInvitation`

**Files:**
- Modify: `packages/database/prisma/schema.prisma`
- Create: `packages/database/prisma/migrations/20260811120000_external_channels/migration.sql` (timestamp after main tip; single migration includes access column, invitation table, CHECKs, guest-external + discoverability guards)
- Test: `pnpm prisma:generate` + migrate on dev DB

**Interfaces:**
- Consumes: `ChatRoom`, `ChatRoomUserMember`, `User`
- Produces:
  - `ChatRoomUserMember.access: String` default `"member"`
  - `ChatRoomGuestInvitation` model mapped to `chat_room_guest_invitation`

- [ ] **Step 1: Update Prisma models**

On `ChatRoomUserMember` add:

```prisma
  /// `"member"` = host-org participant; `"guest"` = external channel only (not org Member).
  access String @default("member")
```

Add model (relations on `User` + `ChatRoom` as needed):

```prisma
model ChatRoomGuestInvitation {
  id              String   @id @default(uuid(7)) @db.Uuid
  roomId          String   @db.Uuid
  room            ChatRoom @relation(fields: [roomId], references: [id], onDelete: Cascade)
  email           String
  inviterId       String
  inviter         User     @relation("ChatRoomGuestInvitationInviter", fields: [inviterId], references: [id], onDelete: Cascade)
  status          String   @default("pending")
  expiresAt       DateTime
  acceptedAt      DateTime?
  acceptedByUserId String?
  acceptedByUser  User?    @relation("ChatRoomGuestInvitationAcceptedBy", fields: [acceptedByUserId], references: [id], onDelete: SetNull)
  createdAt       DateTime @default(now())
  updatedAt       DateTime @updatedAt

  @@index([roomId, status])
  @@index([email, status])
  @@map("chat_room_guest_invitation")
}
```

Wire inverse relations on `User` and `ChatRoom`.

- [ ] **Step 2: Write SQL migration**

```sql
ALTER TABLE "chat_room_user_member" ADD COLUMN "access" TEXT NOT NULL DEFAULT 'member';

CREATE TABLE "chat_room_guest_invitation" (
  "id" UUID NOT NULL,
  "roomId" UUID NOT NULL,
  "email" TEXT NOT NULL,
  "inviterId" TEXT NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'pending',
  "expiresAt" TIMESTAMP(3) NOT NULL,
  "acceptedAt" TIMESTAMP(3),
  "acceptedByUserId" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "chat_room_guest_invitation_pkey" PRIMARY KEY ("id")
);

ALTER TABLE "chat_room_guest_invitation"
  ADD CONSTRAINT "chat_room_guest_invitation_roomId_fkey"
  FOREIGN KEY ("roomId") REFERENCES "chat_room"("id") ON DELETE CASCADE ON UPDATE CASCADE;
-- inviter / acceptedBy FKs to "user"(id) same style as other tables

CREATE INDEX "chat_room_guest_invitation_roomId_status_idx" ON "chat_room_guest_invitation"("roomId", "status");
CREATE INDEX "chat_room_guest_invitation_email_status_idx" ON "chat_room_guest_invitation"("email", "status");

-- One pending invite per room+email (case-normalized emails stored lowercased in app)
CREATE UNIQUE INDEX "chat_room_guest_invitation_room_email_pending_uidx"
  ON "chat_room_guest_invitation" ("roomId", "email")
  WHERE "status" = 'pending';
```

- [ ] **Step 3: Generate client**

Run: `pnpm prisma:generate`  
Expected: success; Prisma types include `access` and `ChatRoomGuestInvitation`

- [ ] **Step 4: Commit**

```bash
git add packages/database/prisma/schema.prisma packages/database/prisma/migrations/
git commit -m "feat(database): external channel guest membership and invitations"
```

---

### Task 2: OpenAPI schemas — discoverability `external` + room DTO fields + invitation DTOs

**Files:**
- Modify: `apps/core/src/schemas/chat-room.schema.ts`
- Create: `apps/core/src/schemas/chat-room-invitation.schema.ts`
- Test: schema unit parse in colocated test or import from route tests in Task 3+

**Interfaces:**
- Produces:
  - `chatRoomDiscoverabilitySchema = z.enum(["public", "private", "external"])`
  - `chatRoomAccessSchema = z.enum(["member", "guest"])`
  - `chatRoomSchema` adds `myAccess: chatRoomAccessSchema`, `organizationName: z.string().nullable()`
  - `discoverableChatRoomSchema.discoverability` allows `"public" | "external"`
  - Invitation request/response schemas (see below)

- [ ] **Step 1: Extend chat room schemas**

Update descriptions for create/update/discoverable to document `external`.

```typescript
export const chatRoomAccessSchema = z
  .enum(["member", "guest"])
  .openapi("ChatRoomAccess");

// On chatRoomSchema object:
myAccess: chatRoomAccessSchema.openapi({
  description:
    "Caller's membership on this room. Guests are not host-org members.",
  example: "member",
}),
organizationName: z.string().nullable().openapi({
  description:
    "Host organization display name. Required for guest rows in list; may be null for personal directs.",
  example: "Acme Corp",
}),
```

- [ ] **Step 2: Add invitation schemas**

```typescript
// apps/core/src/schemas/chat-room-invitation.schema.ts
export const chatRoomInvitationStatusSchema = z
  .enum(["pending", "accepted", "revoked", "declined", "expired"])
  .openapi("ChatRoomInvitationStatus");

export const createChatRoomInvitationRequestSchema = z
  .object({
    email: z.string().trim().email().openapi({ example: "guest@example.com" }),
  })
  .openapi("CreateChatRoomInvitationRequest");

export const chatRoomInvitationSchema = z
  .object({
    id: z.string().uuid(),
    roomId: z.string().uuid(),
    roomName: z.string(),
    organizationId: z.string(),
    organizationName: z.string(),
    email: z.string().email(),
    status: chatRoomInvitationStatusSchema,
    inviter: z.object({
      id: z.string(),
      name: z.string(),
    }),
    expiresAt: dateTimeSchema,
    createdAt: dateTimeSchema,
  })
  .openapi("ChatRoomInvitation");
```

- [ ] **Step 3: Commit**

```bash
git add apps/core/src/schemas/chat-room.schema.ts apps/core/src/schemas/chat-room-invitation.schema.ts
git commit -m "feat(core): OpenAPI schemas for external channels and room invites"
```

---

### Task 3: Access helpers — guests skip host-org membership gate

**Why:** Today `requireChatRoomUserAccess` / `WriteAccess` / `Membership` call `assertRoomOrganizationAccess` → guests with a room row still 404/403. This is the critical auth fix.

**Files:**
- Modify: `apps/core/src/routes/v1/chats/rooms/helpers.ts`
- Modify: `apps/core/src/routes/v1/chats/rooms/helpers.test.ts` (or new focused tests)

**Interfaces:**
- Consumes: `ChatRoomUserMember.access`
- Produces:
  - `mapChatRoomDiscoverability` → `"public" | "private" | "external" | null`
  - `mapChatRoom(..., { myAccess, organizationName })` includes new DTO fields
  - Access helpers: if membership `access === "guest"`, **skip** `assertRoomOrganizationAccess`; if `member`, keep org check
  - `requireJoinableOrgChannel` (rename or extend): `discoverability in ["public","external"]`
  - `requireRoomMemberCanInviteGuests(roomId, userId, tx)` → member access + host org member + external room

- [ ] **Step 1: Write failing tests for guest access**

In `helpers.test.ts` (or route auth tests), assert conceptual behavior via exported helpers:

```typescript
it("allows guest membership without host org membership", async () => {
  // Arrange prisma mocks: room with userMembers [{ userId: GUEST, access: "guest" }], organizationId set
  // Guest is NOT in Member table for that org
  const room = await requireChatRoomUserAccess(ROOM_ID, GUEST_ID, txMock);
  expect(room.id).toBe(ROOM_ID);
});

it("still requires host org membership for access=member", async () => {
  // Member row access=member but resolveMemberOrganizationById fails → throws
});
```

- [ ] **Step 2: Run tests — expect FAIL**

Run: `pnpm --filter core test apps/core/src/routes/v1/chats/rooms/helpers.test.ts`  
Expected: FAIL (guest still hits org gate) or missing `access` handling

- [ ] **Step 3: Implement**

1. Fix `mapChatRoomDiscoverability`:

```typescript
function mapChatRoomDiscoverability(
  kind: string,
  discoverability: string | null,
): "public" | "private" | "external" | null {
  if (kind === "direct") return null;
  if (discoverability === "public") return "public";
  if (discoverability === "external") return "external";
  return "private";
}
```

2. When loading membership for access checks, read `access` from `chatRoomUserMember`.

3. Pattern for all three require* user access helpers:

```typescript
const membership = await tx.chatRoomUserMember.findUnique({
  where: { roomId_userId: { roomId, userId } },
  select: { access: true },
});
// after room found with membership
if (membership?.access !== "guest") {
  await assertRoomOrganizationAccess(room.organizationId, userId, tx);
}
```

Or include `access` on the membership join and branch.

4. Extend joinable helper: `discoverability: { in: ["public", "external"] }` and rename description to joinable org channel. Update `members/me/post.ts` lock check similarly (`public` **or** `external`).

5. `mapChatRoom`: add `myAccess` from membership row for `currentUserId` (default `"member"` if missing for back-compat during rollout), `organizationName` from optional arg or loaded relation.

- [ ] **Step 4: Run tests — expect PASS**

- [ ] **Step 5: Commit**

```bash
git add apps/core/src/routes/v1/chats/rooms/helpers.ts apps/core/src/routes/v1/chats/rooms/helpers.test.ts apps/core/src/routes/v1/chats/rooms/[id]/members/me/post.ts
git commit -m "feat(core): guest-aware chat room access and external join"
```

---

### Task 4: Create external channels (owner/admin only)

**Files:**
- Modify: `apps/core/src/routes/v1/chats/rooms/post.ts`
- Modify: `apps/core/src/routes/v1/chats/rooms/post.test.ts`

**Interfaces:**
- Consumes: `isOrganizationOwnerOrAdmin`, `body.discoverability === "external"`
- Produces: channel with `discoverability: "external"`; seed `userMembers.access = "member"`

- [ ] **Step 1: Failing tests**

```typescript
it("creates external channel for owner", async () => {
  // mock owner role; POST { kind: "channel", name: "Client", discoverability: "external" }
  // expect 201, data.discoverability === "external"
});

it("rejects external channel create for plain member", async () => {
  // mock role member; expect 403
});
```

- [ ] **Step 2: Run — FAIL**

- [ ] **Step 3: Implement in `post.ts`**

After `resolveMemberOrganizationById`, if `body.discoverability === "external"` and not owner/admin → `forbidden(...)`.

On create:

```typescript
userMembers: {
  create: memberUserIds.map((userId) => ({
    userId,
    access: "member",
  })),
},
```

- [ ] **Step 4: Run — PASS**

- [ ] **Step 5: Commit**

```bash
git commit -m "feat(core): allow owner/admin to create external channels"
```

---

### Task 5: List rooms union + discoverable external + DTO fields

**Files:**
- Modify: `apps/core/src/routes/v1/chats/rooms/get.ts`
- Modify: `apps/core/src/routes/v1/chats/rooms/get.test.ts`
- Modify: `apps/core/src/routes/v1/chats/rooms/discoverable/get.ts` + `get.test.ts`
- Modify: `mapChatRoom` call sites to pass `myAccess` / `organizationName` (batch-load org names for guest rooms)

**Interfaces:**
- List `where` (active status) becomes membership of caller AND:

```typescript
// With active organizationId:
{
  archivedAt: null,
  userMembers: { some: { userId } },
  OR: [
    { organizationId },
    { userMembers: { some: { userId, access: "guest" } } },
  ],
}

// No active organization:
{
  archivedAt: null,
  userMembers: { some: { userId } },
  OR: [
    { organizationId: null, kind: "direct" },
    { userMembers: { some: { userId, access: "guest" } } },
  ],
}
```

- Discoverable: `discoverability: { in: ["public", "external"] }`; schema allows both.

- [ ] **Step 1: Failing list tests**

```typescript
it("includes guest rooms when another org is active", async () => {
  // user has guest membership on hostOrg room; activeOrganizationId = otherOrg
  // GET / → includes guest room with myAccess guest and organizationName
});

it("lists external channels in discoverable", async () => {
  // external room not joined → appears in /discoverable
});
```

- [ ] **Step 2: Implement list/discoverable + map fields**

Batch `organization.findMany` for distinct `organizationId`s on returned rooms to fill `organizationName`.  
Resolve `myAccess` from included `userMembers` row for current user (include `access` in `chatRoomInclude` userMembers select if needed — today include is full member rows; add `access` to schema include automatically once column exists).

- [ ] **Step 3: Tests PASS + commit**

```bash
git commit -m "feat(core): list guest rooms across orgs and discover external"
```

---

### Task 6: Host room invitations API

**Files:**
- Create: `apps/core/src/helpers/chat-room-invitation.ts`
- Create: `apps/core/src/routes/v1/chats/rooms/[id]/invitations/post.ts`
- Create: `apps/core/src/routes/v1/chats/rooms/[id]/invitations/get.ts`
- Create: `apps/core/src/routes/v1/chats/rooms/[id]/invitations/[invitationId]/delete.ts`
- Modify: `apps/core/src/routes/v1/chats/rooms/index.ts` — mount routes
- Tests: colocated `*.test.ts`

**Interfaces:**
- `normalizeInvitationEmail(email: string): string` → trim + lowercase
- `INVITE_TTL_MS` e.g. 7 days (match org invite if a constant exists; else 7d)
- `requireRoomMemberCanInviteGuests(roomId, userId, tx)`:
  - room external, not archived
  - caller `access === "member"`
  - caller is host-org member
- POST creates pending row; rejects host-org member emails; rejects guests as callers
- DELETE sets `status: "revoked"` for pending only

- [ ] **Step 1: Failing tests for POST**

```typescript
it("creates pending invitation for external room", async () => {
  // member in room posts { email: "a@b.com" } → 201, status pending
});

it("rejects invite when email is already host org member", async () => {
  // 400
});

it("rejects invite from guest", async () => {
  // 403
});

it("rejects invite on private room", async () => {
  // 400 or 404
});
```

- [ ] **Step 2: Implement routes + helper**

POST logic sketch:

```typescript
const email = normalizeInvitationEmail(body.email);
const room = await requireRoomMemberCanInviteGuests(...);
const existingMember = await memberRepository.getMemberByEmailAndOrg?. // or user by email + member
if (hostOrgMember) throw badRequest("User is already an organization member; they can join the channel directly.");
const invitation = await tx.chatRoomGuestInvitation.create({
  data: {
    roomId,
    email,
    inviterId: userId,
    status: "pending",
    expiresAt: new Date(Date.now() + INVITE_TTL_MS),
  },
});
// fire-and-forget or await email send (Task 8 can wire email; stub ok here with TODO only if email task follows immediately — prefer call render+send in Task 8; this task may call a thin sendChatRoomInvitationEmail service stub)
```

Mount in `rooms/index.ts` **before** generic `/{id}` conflicts (static `invitations` under id is fine as nested path).

- [ ] **Step 3: GET list pending for room + DELETE revoke tests/implement**

- [ ] **Step 4: Commit**

```bash
git commit -m "feat(core): host room invitation create list revoke"
```

---

### Task 7: Invitee invitations API — list pending, get, accept, decline

**Files:**
- Create: `apps/core/src/routes/v1/chats/invitations/get.ts` (collection `?status=pending`)
- Create: `apps/core/src/routes/v1/chats/invitations/[id]/get.ts`
- Create: `apps/core/src/routes/v1/chats/invitations/[id]/accept/post.ts`
- Create: `apps/core/src/routes/v1/chats/invitations/[id]/decline/post.ts`
- Create: `apps/core/src/routes/v1/chats/invitations/index.ts`
- Modify: `apps/core/src/routes/v1/chats/index.ts`:

```typescript
import invitationsRouter from "./invitations/index.js";
app.route("/invitations", invitationsRouter);
app.route("/rooms", roomsRouter);
```

**Interfaces:**
- Collection: `status` query default `pending`; filter `email = normalize(user.email)` and not expired (or mark expired)
- Accept:
  - invitation pending, not expired, email matches
  - room still external, not archived
  - user must **not** be host-org member (if they are, 400)
  - upsert `ChatRoomUserMember { access: "guest" }` + readState
  - set invitation `accepted` + `acceptedByUserId` / `acceptedAt`
  - idempotent if already guest on room
- Decline: pending + email match → `declined`
- Get by id: require auth; email match for full DTO (spec: prefer require auth)

- [ ] **Step 1: Failing accept matrix tests**

```typescript
it("accept creates guest membership without Member row", async () => { ... });
it("accept rejects email mismatch", async () => { ... });
it("list pending returns invite for matching email", async () => { ... });
it("decline sets declined", async () => { ... });
```

- [ ] **Step 2: Implement + PASS**

- [ ] **Step 3: Commit**

```bash
git commit -m "feat(core): accept decline and list room invitations"
```

---

### Task 8: Patch rules + guest cannot manage room

**Files:**
- Modify: `apps/core/src/routes/v1/chats/rooms/[id]/patch.ts` + tests
- Modify: archive/delete/restore if they only check org role (guests already fail org role — ensure they 403/404 via access helper guest path without elevation)

**Rules:**
- If `body.discoverability` changes away from `external` while guest members or pending invites exist → `badRequest`
- Guests calling PATCH → forbidden (even roster): check `access !== "member"` or require host org role for any patch
- Prefer: PATCH requires `access === "member"` + existing settings/roster gates

- [ ] **Step 1–4: TDD + commit**

```bash
git commit -m "fix(core): block external discoverability convert and guest patch"
```

---

### Task 9: Email — chat room invitation

**Files:**
- Modify: `packages/email/src/types.ts` — `ChatRoomInvitationEmailProps`
- Modify: `packages/email/src/renderers/auth.tsx` (or new `chat.tsx`) — `renderChatRoomInvitationEmail`
- Modify: locales under `packages/email/src/locales/`
- Modify: `packages/email/src/renderers/index.ts`, `index.ts` exports
- Test: `packages/email/src/__tests__/renderers.test.tsx`
- Wire send from Task 6 POST (Core email send path used by org invites — find existing Resend/send helper and mirror)

**Props:**

```typescript
export interface ChatRoomInvitationEmailProps extends LocalizedEmailProps {
  invitationLink: string; // `${WEB_URL}/chat/invites/${id}`
  invitorUsername: string;
  organizationName: string;
  channelName: string;
}
```

- [ ] **Step 1–4: TDD renderer + wire POST + commit**

```bash
git commit -m "feat(email): chat room invitation email"
```

---

### Task 10: Regenerate web Core client

**Files:**
- Generated under `apps/web/src/lib/clients/generated/core/` (do not hand-edit)
- Any thin wrappers in `apps/web/src/lib/services/chat-room.service.ts` if present

- [ ] **Step 1:** `pnpm --filter web generate:core:snapshot`
- [ ] **Step 2:** `pnpm --filter web typecheck` — fix call sites for new required DTO fields (`myAccess`, `organizationName`) with safe defaults only if generator marks required
- [ ] **Step 3: Commit**

```bash
git commit -m "chore(web): regenerate Core client for external channels"
```

---

### Task 11: Web — create/edit external visibility

**Files:**
- Modify: `apps/web/src/app/(app)/chat/components/create-channel-wizard.ts`
- Modify: `apps/web/src/app/(app)/chat/components/create-channel-dialog.tsx`
- Modify: `apps/web/src/app/(app)/chat/components/edit-channel-dialog.tsx`
- Modify: `apps/web/src/components/chat/channel-discoverability-icon.tsx` (+ test)
- Modify: `apps/web/messages/en.json` (and other locales via translations skill patterns) under `App.Channels.Visibility`
- Tests: wizard + icon tests

**UI:**
- `Discoverability = "public" | "private" | "external"`
- Third radio: External + help text from spec
- Create: only show External if user is owner/admin (prop from page)
- Edit: show external; converting away blocked by API (surface error toast)
- Icon: use distinct icon for external (e.g. `Users` / `Globe2` — pick one Lucide already used)

- [ ] **Step 1–4: TDD wizard + commit**

```bash
git commit -m "feat(web): external channel visibility in create and edit"
```

---

### Task 12: Web — External sidebar (pending + joined)

**Files:**
- Modify: `apps/web/src/components/chat/organization-chat-list.client.tsx`
- Modify: `apps/web/src/app/(app)/chat/actions.ts` or services — `listPendingChatRoomInvitationsAction`, ensure room list uses updated Core list
- Modify: chat page data loader to fetch pending invites in parallel
- i18n: `App.Channels.External.*`

**Behavior:**
- Section **External** always rendered (even without active org if there are guest rooms/pending)
- Pending rows: room name, org name, Accept / Decline buttons → call accept/decline actions, refresh
- Joined guest rooms: filter `myAccess === "guest"` from room list; link `/chat/rooms/{id}`; show org name subtitle
- Do not put guest rooms only under org Channels section (either exclusive External section for guests, or dual — **prefer External only for guest rows** so they don't appear as normal host channels)

- [ ] **Step 1: Unit test pure split helper**

```typescript
// e.g. partitionRoomsForSidebar(rooms) => { channels, directs, externalJoined }
export function partitionRoomsForSidebar(rooms: ChatRoom[]) {
  const externalJoined = rooms.filter((r) => r.myAccess === "guest");
  const rest = rooms.filter((r) => r.myAccess !== "guest");
  // existing channel/direct split on rest
}
```

- [ ] **Step 2: Wire UI + actions**
- [ ] **Step 3: Commit**

```bash
git commit -m "feat(web): External sidebar for pending invites and guest rooms"
```

---

### Task 13: Web — invite from room settings + accept deep link page

**Files:**
- Modify: edit channel / room settings panel — Invite guest email form when `discoverability === "external"` and viewer is org member in room
- Create: `apps/web/src/app/(app)/chat/invites/[id]/page.tsx` (or `(flows)/chat-invites/[id]` matching accept-invitation style)
- Mirror patterns from `apps/web/src/app/(flows)/accept-invitation/[id]/`
- Actions: createInvitation, listRoomInvitations, revoke, accept, decline

**Accept page:**
- Load `GET /v1/chats/invitations/{id}`
- Show org name, channel name, inviter
- Accept → redirect `/chat/rooms/{roomId}`
- Decline → redirect `/chat`
- Email mismatch / expired → error card

- [ ] **Step 1–4: Implement + smoke tests if existing page test patterns + commit**

```bash
git commit -m "feat(web): room guest invite UI and accept page"
```

---

### Task 14: Verification sweep

- [ ] **Step 1: Core tests**

Run: `pnpm --filter core test`  
Expected: PASS (or targeted suites if full suite too long: rooms + invitations)

- [ ] **Step 2: Web typecheck + relevant tests**

Run: `pnpm --filter web typecheck`  
Run: `pnpm --filter web test` paths for wizard, icon, sidebar partition, chat-room service

- [ ] **Step 3: Manual checklist**

1. Owner creates external channel  
2. Org member browses + self-joins  
3. Member invites external email  
4. Invitee sees pending under External (any org active)  
5. Accept → guest room opens; no host org membership  
6. Guest posts message; cannot open invite UI  
7. Guest with other org active still sees External section  

- [ ] **Step 4: Final commit only if fixes landed**

---

## Spec coverage checklist

| Spec item | Task |
|-----------|------|
| `discoverability: external` | 1–2, 4, 11 |
| `access` member/guest | 1, 3, 7 |
| `ChatRoomGuestInvitation` | 1, 6–7 |
| Guest no seat / no org Member | 7 |
| Owner/admin create external | 4 |
| Org member invite guests | 6 |
| Guest full room RW, no invite | 3, 8, 13 |
| Org public-like browse/join | 3, 5 |
| List union + always External UI | 5, 12 |
| Pending in sidebar v1 | 7, 12 |
| Routes without guest- prefix | 6–7 |
| Block convert with guests/pending | 8 |
| Email invite | 9 |
| Shareable links | deferred (non-goal) |

## Placeholder / consistency notes

- Invitation email normalization: always store lowercase.
- `mapChatRoom` **must** emit `myAccess` + `organizationName` everywhere `chatRoomSchema.parse` is used (grep call sites after Task 2).
- Ably auth: if room subscribe path uses org membership, extend the same guest exception as Task 3 (search `requireChatRoomUserAccess` / ably token routes).
- Rate-limit: optional simple in-process or reuse existing rate limit middleware if present; if none, skip v1 and note in PR (spec preferred but not blocking if no pattern exists).

---

## Execution handoff

Plan saved to `docs/superpowers/plans/2026-08-05-external-channels.md`.

**Two execution options:**

1. **Subagent-Driven (recommended)** — fresh subagent per task, review between tasks  
2. **Inline Execution** — this session with executing-plans and checkpoints  

Which approach?
