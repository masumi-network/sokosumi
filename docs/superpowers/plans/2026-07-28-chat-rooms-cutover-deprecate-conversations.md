# Chat Rooms Cutover — Deprecate Conversations Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Product chat runs only on `chat_room*`: web home `/chat` + `/chat/rooms/{roomId}`, room-keyed AI stream, no conversation UI or new `conversation*` rows from product paths.

**Architecture:** Add room-keyed stream under Core `/v1/chats/rooms/{id}/stream` that persists to `chat_room_message` and stores coworker provider thread id on `ChatRoom.providerConversationId`. Move today’s channels shell under `/chat` with path-param room opens. Delete `/channels` and legacy conversation routes/providers. Leave `conversation*` tables and deprecated Core conversation routes in place (no data migration).

**Tech Stack:** Hono/OpenAPI (Core), Prisma, Vercel AI SDK `streamText`, Next.js App Router, Vitest, generated Core client (`pnpm --filter web generate:core:snapshot`).

**Spec:** `docs/superpowers/specs/2026-07-28-chat-rooms-cutover-deprecate-conversations-design.md`

## Global Constraints

- Base path `/chat`; open room `/chat/rooms/{roomId}` for channel and direct
- No redirects for `/channels/*` or legacy `/chat/.../conversation/...` (404)
- Soft-deprecate conversations: web must not call conversation APIs; DB tables stay
- Keep existing `directKey` create-or-get (do not invent a second uniqueness scheme)
- ≤1 coworker on direct already enforced in Core `rooms/post.ts` — do not re-implement
- Channel `@coworker` mention dispatch (`generateText`) stays for channels; coworker **1:1 direct** uses room stream (no double reply via auto-mention)
- Pin no new deps; Biome + neverthrow patterns; web never imports `@sokosumi/database`
- After Core OpenAPI changes: `pnpm --filter web generate:core:snapshot` then `pnpm --filter web typecheck`
- Branch context: `codex/chat-channels` (or successor cutover branch)

## File map

| File | Responsibility |
|------|----------------|
| `packages/database/prisma/schema.prisma` | Add optional `ChatRoom.providerConversationId` |
| New migration under `packages/database/prisma/migrations/` | Column + partial unique index |
| `apps/core/src/helpers/persist-assistant-to-chat-room.ts` | Persist AI SDK assistant turn → `chat_room_message` |
| `apps/core/src/helpers/chat-room-messages-to-ui-messages.ts` | Room messages → AI SDK `UIMessage[]` for resume/history |
| `apps/core/src/routes/v1/chats/rooms/[id]/stream/post.ts` | Room-keyed `streamText` POST |
| `apps/core/src/routes/v1/chats/rooms/[id]/stream/get.ts` | Load room messages as UIMessage[] (`?roomId` implicit from path) |
| `apps/core/src/routes/v1/chats/rooms/[id]/stream/stream-get.ts` | Resume resumable SSE by room id |
| `apps/core/src/routes/v1/chats/rooms/[id]/stream/index.ts` | Mount stream routes |
| `apps/core/src/routes/v1/chats/rooms/index.ts` | Mount `/{id}/stream` |
| `apps/core/src/routes/v1/chats/rooms/[id]/messages/post.ts` | Skip auto coworker mention on coworker-only directs (stream owns reply) |
| `apps/core/src/schemas/chat-room.schema.ts` | Expose `providerConversationId` on room DTO if needed |
| `apps/web/src/app/api/chat/route.ts` | Proxy to room stream (`roomId` not `conversationId`) |
| `apps/web/src/app/api/chat/[roomId]/stream/route.ts` | Resume proxy (rename from conversationId) |
| `apps/web/src/app/(app)/chat/page.tsx` | Landing + drafts (from channels page) |
| `apps/web/src/app/(app)/chat/rooms/[roomId]/page.tsx` | Open room |
| `apps/web/src/app/(app)/chat/components/*` | Moved channels components |
| `apps/web/src/app/(app)/chat/actions.ts` | Moved channels actions |
| Delete `apps/web/src/app/(app)/channels/**` | Hard remove |
| Delete legacy `chat/[bucketSlug]/**`, most of `chat-ui/` conversation shell | Hard remove |
| `apps/web/src/components/chat/organization-chat-list.client.tsx` | Links → `/chat/rooms/{id}` only |
| `apps/web/src/lib/utils/notification-href.ts` | Drop / noop `CONVERSATION` deep links |
| `apps/web/src/app/(app)/history/**` | Hide `CONVERSATION` kind |
| `apps/web/src/app/(app)/layout.tsx` | Remove `ConversationsProvider` if unused |
| `apps/web/src/contexts/conversations-context.tsx` + conversation actions | Remove or leave unused dead code deleted |
| `docs/superpowers/specs/2026-07-27-chats-api-and-chat-room-schema-design.md` | Mark conversation absorb deferred item as in progress / superseded by 2026-07-28 spec |

---

### Task 1: Schema — `ChatRoom.providerConversationId`

**Files:**
- Modify: `packages/database/prisma/schema.prisma` (`ChatRoom` model)
- Create: `packages/database/prisma/migrations/<timestamp>_chat_room_provider_conversation_id/migration.sql`
- Test: migration applies via `pnpm prisma:migrate:deploy` (or `migrate:dev` locally)

**Interfaces:**
- Consumes: existing `ChatRoom` model
- Produces: `ChatRoom.providerConversationId: string | null` (optional unique when set)

- [ ] **Step 1: Add field to Prisma model**

On `ChatRoom`:

```prisma
  /// Remote coworker Conversations API id for streaming 1:1 directs (not used for channel mention threads).
  providerConversationId String?
```

Add a unique constraint only when non-null via SQL partial unique (Prisma `@@unique` on nullable is OK if product wants global uniqueness of remote ids — prefer **partial unique WHERE NOT NULL** in SQL migration, matching `directKey` style):

```sql
ALTER TABLE "chat_room" ADD COLUMN "providerConversationId" TEXT;

CREATE UNIQUE INDEX "chat_room_providerConversationId_key"
  ON "chat_room"("providerConversationId")
  WHERE "providerConversationId" IS NOT NULL;
```

- [ ] **Step 2: Create migration and generate client**

Run:

```bash
pnpm prisma:migrate:dev --name chat_room_provider_conversation_id
pnpm prisma:generate
```

Expected: migration folder created; generate succeeds.

- [ ] **Step 3: Commit**

```bash
git add packages/database/prisma/schema.prisma packages/database/prisma/migrations
git commit -m "$(cat <<'EOF'
feat(database): add chat_room providerConversationId

Store coworker provider thread on the room for streaming directs without conversation*.
EOF
)"
```

---

### Task 2: Core helpers — persist + UIMessage mapping for rooms

**Files:**
- Create: `apps/core/src/helpers/persist-assistant-to-chat-room.ts`
- Create: `apps/core/src/helpers/chat-room-messages-to-ui-messages.ts`
- Create: `apps/core/src/helpers/__tests__/persist-assistant-to-chat-room.test.ts`
- Create: `apps/core/src/helpers/__tests__/chat-room-messages-to-ui-messages.test.ts`
- Reference: `apps/core/src/helpers/persist-assistant-from-ai-sdk.ts`, `apps/core/src/helpers/conversation-messages-to-ui-messages.ts`

**Interfaces:**
- Consumes: `PersistedChatUiPart`, prisma, message-content helpers
- Produces:
  - `persistAssistantToChatRoom(params: { roomId: string; senderCoworkerId: string; contentText: string; responsesApiResponseId?: string | null; reasoning?: unknown; thoughtTiming?: { startedAtMs: number; endedAtMs: number }; uiParts?: PersistedChatUiPart[] }): Promise<{ id: string }>`
  - `persistUserMessageToChatRoom(params: { roomId: string; senderUserId: string; contentText: string; metadata?: Record<string, unknown> }): Promise<{ id: string }>`
  - `chatRoomMessagesToUiMessages(rows: Array<{ id: string; content: string; senderUserId: string | null; senderCoworkerId: string | null; metadata: unknown; createdAt: Date }>): UIMessage[]`

- [ ] **Step 1: Write failing tests for assistant persist**

```typescript
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/db/prisma", () => ({
  default: {
    chatRoomMessage: { create: vi.fn() },
  },
}));

import prisma from "@/lib/db/prisma";
import { persistAssistantToChatRoom } from "../persist-assistant-to-chat-room";

describe("persistAssistantToChatRoom", () => {
  beforeEach(() => {
    vi.mocked(prisma.chatRoomMessage.create).mockResolvedValue({
      id: "msg_assistant",
    } as never);
  });

  it("creates chat_room_message with senderCoworkerId and content", async () => {
    const result = await persistAssistantToChatRoom({
      roomId: "room_1",
      senderCoworkerId: "coworker_1",
      contentText: "Hello from coworker",
    });
    expect(result.id).toBe("msg_assistant");
    expect(prisma.chatRoomMessage.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          roomId: "room_1",
          senderCoworkerId: "coworker_1",
          content: "Hello from coworker",
          senderUserId: null,
        }),
      }),
    );
  });
});
```

- [ ] **Step 2: Run test — expect FAIL**

```bash
pnpm --filter core test src/helpers/__tests__/persist-assistant-to-chat-room.test.ts
```

Expected: FAIL — module not found.

- [ ] **Step 3: Implement helpers**

Mirror metadata shape from `persist-assistant-from-ai-sdk.ts` (reasoning / thought_timing_ms / ui parts) into `ChatRoomMessage.metadata`. Map roles: user → `senderUserId`, assistant → `senderCoworkerId` (room stream is coworker-only for AI). For `chatRoomMessagesToUiMessages`, map user/coworker senders to AI SDK roles `"user"` / `"assistant"`.

- [ ] **Step 4: Run tests — expect PASS**

```bash
pnpm --filter core test src/helpers/__tests__/persist-assistant-to-chat-room.test.ts src/helpers/__tests__/chat-room-messages-to-ui-messages.test.ts
```

- [ ] **Step 5: Commit**

```bash
git add apps/core/src/helpers/persist-assistant-to-chat-room.ts \
  apps/core/src/helpers/chat-room-messages-to-ui-messages.ts \
  apps/core/src/helpers/__tests__/
git commit -m "$(cat <<'EOF'
feat(core): persist AI SDK turns to chat_room_message

Room stream needs room-native persistence instead of conversationMessage.
EOF
)"
```

---

### Task 3: Core — room stream POST (TDD smoke)

**Files:**
- Create: `apps/core/src/routes/v1/chats/rooms/[id]/stream/post.ts`
- Create: `apps/core/src/routes/v1/chats/rooms/[id]/stream/post.test.ts`
- Create: `apps/core/src/routes/v1/chats/rooms/[id]/stream/index.ts`
- Modify: `apps/core/src/routes/v1/chats/rooms/index.ts` — mount stream router under `/{id}/stream`
- Reference (adapt, do not call conversation tables): `apps/core/src/routes/v1/chats/stream/post.ts`, `coworker-conversation.ts` (`createCoworkerConversation` / ensure pattern writing to **room** `providerConversationId`)

**Interfaces:**
- Consumes: room membership helpers from `rooms/helpers.ts`, Task 2 persist helpers, `ensure` adapted for room
- Produces: OpenAPI `POST /v1/chats/rooms/{id}/stream` — AI SDK body compatible with current chat request schema where possible; response SSE; header `x-sokosumi-room-id`

**Behavior:**
1. `requireUserAuthContext` (or existing room auth).
2. Load room by id; require membership; require exactly one `coworkerMembers` for streaming path (badRequest otherwise — human-only rooms use message POST).
3. Ensure `room.providerConversationId` via create/reuse remote conversation (adapt `ensureCoworkerProviderConversation` to update `chatRoom` instead of `conversation`).
4. Persist user turn → `chat_room_message`.
5. `streamText` with coworker provider options including `providerConversationId`.
6. On finish → `persistAssistantToChatRoom`.
7. Do **not** create `conversation*` rows.

- [ ] **Step 1: Write failing route contract test**

Follow patterns in `apps/core/src/routes/v1/chats/rooms/[id]/messages/post.test.ts` (auth + membership mocks). Assert:

- 404 when room missing / not member
- 400 when room has zero coworker members
- On happy path (mock `streamText` / prisma): user message created on `chatRoomMessage`, no `conversation.create` / `conversationMessage.create`

- [ ] **Step 2: Run test — expect FAIL**

```bash
pnpm --filter core test src/routes/v1/chats/rooms/\[id\]/stream/post.test.ts
```

- [ ] **Step 3: Implement POST + mount**

Extract shared pieces from legacy `stream/post.ts` only where needed (locks, billing errors, image upload). Prefer a focused room handler over copying all model/OpenRouter paths unless the room UX requires them — **minimum for coworker 1:1**: coworker mode stream + text persistence. Document in code comment if image/web-search are deferred to follow-up.

Mount in `rooms/index.ts` **before** generic `/{id}` if path conflicts require it (static `stream` segment under `[id]` is fine as nested router).

- [ ] **Step 4: Run test — expect PASS**

- [ ] **Step 5: Commit**

```bash
git commit -m "$(cat <<'EOF'
feat(core): add room-keyed chat stream endpoint

Coworker 1:1 AI runs on chat_room without conversation* rows.
EOF
)"
```

---

### Task 4: Core — room stream GET + resume

**Files:**
- Create: `apps/core/src/routes/v1/chats/rooms/[id]/stream/get.ts`
- Create: `apps/core/src/routes/v1/chats/rooms/[id]/stream/stream-get.ts`
- Create: matching `*.test.ts`
- Modify: `stream/index.ts` mounts
- Reference: `apps/core/src/routes/v1/chats/stream/get.ts`, `stream-get.ts`

**Interfaces:**
- `GET /v1/chats/rooms/{id}/stream` — returns UIMessage[] (or `{ messages }`) for client hydrate
- `GET /v1/chats/rooms/{id}/stream/resume` or path mirroring legacy `GET /v1/chats/stream/{conversationId}` → use `GET /v1/chats/rooms/{id}/stream/active` for resumable SSE (pick one name; document in OpenAPI). Prefer: **`GET /v1/chats/rooms/{id}/stream/active`** for resume to avoid clashing with message-list GET.

Clarify OpenAPI:

| Method | Path | Role |
|--------|------|------|
| POST | `/rooms/{id}/stream` | Send + stream |
| GET | `/rooms/{id}/stream/messages` | History as UIMessages |
| GET | `/rooms/{id}/stream/active` | Resume active SSE |

- [ ] **Step 1: Failing tests for membership + empty history**

- [ ] **Step 2: Implement using `chatRoomMessagesToUiMessages`**

- [ ] **Step 3: Pass tests + commit**

```bash
git commit -m "$(cat <<'EOF'
feat(core): add room stream history and resume endpoints
EOF
)"
```

---

### Task 5: Core — skip auto-mention on coworker-only directs

**Files:**
- Modify: `apps/core/src/routes/v1/chats/rooms/[id]/messages/post.ts`
- Modify: `apps/core/src/routes/v1/chats/rooms/[id]/messages/post.test.ts`

**Interfaces:**
- When room `kind === "direct"` and exactly one coworker member and no other humans besides sender: **do not** create `chatRoomMention` / `dispatchChatRoomMention` (stream owns the reply).
- Channels and human directs unchanged.

- [ ] **Step 1: Failing test** — coworker-only direct POST message creates message, zero mentions, no dispatch mock call

- [ ] **Step 2: Implement guard** before mention creation block

- [ ] **Step 3: Pass + commit**

```bash
git commit -m "$(cat <<'EOF'
fix(core): skip mention dispatch on coworker-only directs

Room stream owns 1:1 coworker replies; avoid duplicate generateText.
EOF
)"
```

---

### Task 6: Regenerate web Core client

**Files:**
- Regenerated: `apps/web/src/lib/clients/generated/core/**`
- Possibly: `apps/web/src/lib/services/chat-room.service.ts` (add stream helpers if hand-wrapped)

- [ ] **Step 1: Snapshot + generate**

```bash
pnpm --filter web generate:core:snapshot
pnpm --filter web typecheck
```

- [ ] **Step 2: Commit generated client**

```bash
git commit -m "$(cat <<'EOF'
chore(web): regenerate Core client for room stream
EOF
)"
```

---

### Task 7: Web BFF — proxy room stream

**Files:**
- Modify: `apps/web/src/app/api/chat/route.ts` — require `roomId` in body/query; proxy to `chats/rooms/{roomId}/stream`
- Rename/replace: `apps/web/src/app/api/chat/[conversationId]/stream/route.ts` → `apps/web/src/app/api/chat/[roomId]/stream/route.ts` proxying `.../rooms/{roomId}/stream/active`
- Modify: `apps/web/src/app/(app)/chat-ui/utils/chat-route-base.ts` — `CHAT_API_PATH` stays `/api/chat`; document roomId
- Test: add/adjust route tests if present; otherwise manual curl checklist in commit body

**Interfaces:**
- POST body includes `roomId` (remove requirement for `conversationId`)
- GET history uses `?roomId=`

- [ ] **Step 1: Update BFF to fail closed without roomId**

```typescript
const roomId =
  typeof body.roomId === "string" ? body.roomId.trim() : "";
if (!roomId) {
  return NextResponse.json(
    { error: "Bad Request", message: "Body field roomId is required." },
    { status: 400 },
  );
}
const coreUrl = `${getCoreApiBaseUrl()}/chats/rooms/${roomId}/stream`;
```

- [ ] **Step 2: Typecheck web**

```bash
pnpm --filter web typecheck
```

- [ ] **Step 3: Commit**

```bash
git commit -m "$(cat <<'EOF'
feat(web): proxy /api/chat to room-keyed Core stream
EOF
)"
```

---

### Task 8: Web routes — `/chat` + `/chat/rooms/[roomId]` (move channels)

**Files:**
- Create: `apps/web/src/app/(app)/chat/rooms/[roomId]/page.tsx`
- Rewrite: `apps/web/src/app/(app)/chat/page.tsx` — port logic from `channels/page.tsx` (drafts + empty)
- Rewrite: `apps/web/src/app/(app)/chat/layout.tsx` — shell for channels client (drop `ChatLayoutClient` conversation shell)
- Move: `channels/components/**`, `channels/actions.ts`, `channels/utils/**` → `chat/` (or `chat/rooms/` colocated). Prefer `apps/web/src/app/(app)/chat/` as home for former channels code.
- Update all internal `router.replace('/channels?channel=...')` → `/chat/rooms/${id}`
- Update drafts: `?create=channel`, `?dm=new` on `/chat`
- Delete: `apps/web/src/app/(app)/channels/**` entirely (no redirects)

**Interfaces:**
- Landing `/chat` with optional searchParams `create`, `dm`
- Room page params `{ roomId: string }`

- [ ] **Step 1: Move/adapt page + client; keep tests for merge helpers**

Update imports after move. Fix `organization-chat-list` links in Task 9 if still pointing at `/channels`.

- [ ] **Step 2: Delete channels app directory**

- [ ] **Step 3: `pnpm --filter web typecheck` + `pnpm --filter web test` for moved utils**

- [ ] **Step 4: Commit**

```bash
git commit -m "$(cat <<'EOF'
feat(web): serve channels UI under /chat/rooms/{roomId}

Remove /channels routes with no redirects per cutover spec.
EOF
)"
```

---

### Task 9: Sidebar, history, notifications — room-only links

**Files:**
- Modify: `apps/web/src/components/chat/organization-chat-list.client.tsx`
  - Remove `buildCoworkerDirectConversations` / conversation hrefs
  - Show coworker-only directs from **rooms** list (stop hiding via `isCoworkerOnlyDirectChannel` if that hid room shells — show them under Directs → `/chat/rooms/{id}`)
  - Channel/DM hrefs: `/chat/rooms/${room.id}`
- Modify: `apps/web/src/lib/utils/notification-href.ts` + tests — `CONVERSATION` → `null` or `/chat` (no conversation path)
- Modify: history filters/list — omit `CONVERSATION` kind from default feed (or filter client-side)
- Modify: `draft-direct-message.tsx` — solo coworker → create-or-get room → `/chat/rooms/{id}` (already partially there; remove `/chat?coworker=` hop)

- [ ] **Step 1: Update notification-href tests first (TDD)**

```typescript
it("does not deep-link legacy conversations", () => {
  expect(
    getNotificationHref({
      kind: "CONVERSATION",
      entityId: "conv_1",
      // ...required fields per existing helper
    }),
  ).toBeNull(); // or "/chat" — pick one and stick to it; prefer null
});
```

- [ ] **Step 2: Implement sidebar + history + drafts**

- [ ] **Step 3: Pass tests + commit**

```bash
git commit -m "$(cat <<'EOF'
feat(web): point chat nav at rooms only

Drop conversation deep links from sidebar, history, and notifications.
EOF
)"
```

---

### Task 10: Wire streaming UI in room pane for coworker directs

**Files:**
- Modify: room client (former `channels-client.tsx`) — when selected room is coworker-only direct, use AI SDK `useChat` (or existing chat-interface stream hook) against `/api/chat` with `roomId`
- Human/channel rooms: keep POST message + poll / mention status
- Remove dependency on `ConversationsProvider` for this path

**Interfaces:**
- Consumes: Task 7 BFF `roomId`
- Produces: streamed assistant messages appearing in room transcript (optimistic user + stream tokens)

- [ ] **Step 1: Detect coworker-only direct**

```typescript
function isCoworkerOnlyDirectRoom(room: {
  kind: string;
  userMembers: { userId: string }[];
  coworkerMembers: { coworkerId: string }[];
}): boolean {
  return (
    room.kind === "direct" &&
    room.coworkerMembers.length === 1 &&
    room.userMembers.length <= 1
  );
}
```

- [ ] **Step 2: Branch composer submit → stream vs `sendMessage` action**

- [ ] **Step 3: Manual smoke (dev):** open coworker DM, send message, see streamed reply as `chat_room_message` (verify via Core GET messages)

- [ ] **Step 4: Commit**

```bash
git commit -m "$(cat <<'EOF'
feat(web): stream coworker DMs inside room pane
EOF
)"
```

---

### Task 11: Delete legacy conversation UI + providers

**Files (delete or gut):**
- `apps/web/src/app/(app)/chat/[bucketSlug]/**`
- `apps/web/src/app/(app)/chat-ui/components/chat-layout-client.tsx`, `chat-interface.tsx`, `chat-conversations-sidebar.tsx` (if unused)
- `apps/web/src/contexts/conversations-context.tsx`
- `apps/web/src/app/(app)/chat/hooks/use-conversations.ts`
- `apps/web/src/lib/actions/conversation/**` (if nothing else imports)
- Remove `ConversationsProvider` from `apps/web/src/app/(app)/layout.tsx`
- Leave Core `/v1/chats/conversations*` mounted + deprecated; optionally stop mounting `/v1/chats/stream` conversation routes **only after** web BFF no longer references them (Task 7 done)

- [ ] **Step 1: `rg` for imports of conversation actions / ConversationsProvider / chat-ui ChatInterface**

```bash
rg -n "ConversationsProvider|useConversations|createConversation|chat-interface|ChatLayoutClient" apps/web/src
```

Remove all product references.

- [ ] **Step 2: Delete dead files; fix typecheck**

```bash
pnpm --filter web typecheck
pnpm --filter web test
```

- [ ] **Step 3: Commit**

```bash
git commit -m "$(cat <<'EOF'
refactor(web): remove legacy conversation chat UI

Product paths use rooms only; conversation* data remains in DB.
EOF
)"
```

---

### Task 12: Core — stop serving conversation stream (optional same release)

**Files:**
- Modify: `apps/core/src/routes/v1/chats/index.ts` — unmount `./stream` if unused
- Keep `./conversations` mounted with `deprecated: true`

Only do this when `rg "chats/stream"` in `apps/web` is empty (room paths only).

- [ ] **Step 1: Confirm no web callers**

```bash
rg -n "chats/stream" apps/web
```

- [ ] **Step 2: Unmount conversation stream router; keep files for a short period or delete in same commit if unused

- [ ] **Step 3: Core tests + commit

```bash
git commit -m "$(cat <<'EOF'
chore(core): unmount conversation-keyed chat stream

Room stream replaces product streaming; conversation routes stay deprecated.
EOF
)"
```

---

### Task 13: Spec cross-links + final verification

**Files:**
- Modify: `docs/superpowers/specs/2026-07-27-chats-api-and-chat-room-schema-design.md` — Deferred “Full absorb” → point to 2026-07-28 cutover spec / mark superseded for product path
- Smoke checklist

- [ ] **Step 1: Update related spec deferred blurb**

- [ ] **Step 2: Run**

```bash
pnpm check
pnpm --filter core test
pnpm --filter web test
pnpm --filter web typecheck
pnpm --filter core typecheck
```

- [ ] **Step 3: Manual checklist**
  - `/chat` loads
  - Create channel → `/chat/rooms/{id}`
  - Create human DM → `/chat/rooms/{id}`
  - Create coworker DM → stream works; no `/channels`; no conversation sidebar
  - `/channels` → 404
  - Old conversation URL → 404
  - History has no conversation deep links

- [ ] **Step 4: Commit docs + any fixes**

```bash
git commit -m "$(cat <<'EOF'
docs(chat): mark conversation absorb cutover in related spec
EOF
)"
```

---

## Spec coverage (self-review)

| Spec requirement | Task(s) |
|------------------|---------|
| `/chat` + `/chat/rooms/{roomId}` | 8 |
| No `/channels` redirects | 8 |
| Room-keyed stream | 3, 4, 7, 10 |
| Persist to `chat_room_message` | 2, 3 |
| Provider bridge off `conversation*` | 1, 3 (`ChatRoom.providerConversationId`) |
| Soft-deprecate conversations / keep DB | 11, 12 |
| `directKey` as-is | (no task — leave alone) |
| ≤1 coworker on direct | Already shipped — skipped |
| Skip double reply on coworker DM | 5 |
| Sidebar/history/notifications | 9 |
| Hide conversation UI | 11 |
| Testing | Per-task + 13 |
| No history migration / no table drop | Non-goal — no task |

## Placeholder / consistency notes

- Resume path named **`/stream/active`** in Task 4 — keep web BFF aligned (Task 7).
- Image/web-search on room stream: minimum viable coworker text stream first; extend only if `/chat` coworker UX required those features day one (check product; otherwise follow-up).
- `isCoworkerOnlyDirectRoom` membership count: creator is a user member — expect `userMembers.length === 1` + `coworkerMembers.length === 1`.
