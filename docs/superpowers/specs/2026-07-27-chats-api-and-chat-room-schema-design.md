# Chats API namespace + chat_room schema design

**Date:** 2026-07-27  
**Status:** Approved for implementation  
**Branch context:** Unmerged `codex/chat-channels` (squash migrations; hard cut)

## Goal

Durable org chat under `/v1/chats` with a hardened `chat_room*` schema. Keep AI SDK stream/resume working. Leave `conversation*` parallel for now.

## Non-goals

- Hermes
- Migrating or deleting `conversation` / `conversationMessage`
- Any `/direct` path (collection or action)
- Nesting under `/workspaces/{id}`
- Changing coworker Responses/Conversations at `coworker.baseURL`
- Provider-thread table
- Legacy path aliases (hard cut with web + Core in the same release)

## API

| Topic | Choice |
| --- | --- |
| Namespace | `/v1/chats` |
| Rooms | `/v1/chats/rooms` |
| DTO id | `roomId` |
| Cutover | Hard cut: remove `/chat-channels`, `/conversations`, `/chat` |
| Stream | `POST /v1/chats/stream`; resume `GET /v1/chats/stream/{conversationId}` (AI SDK body unchanged) |
| Conversations | `/v1/chats/conversations` (OpenAPI-deprecated) |
| Org | Auth org (`activeOrganizationId` / API key + `X-Organization-Slug`); not in path |
| Auth | User actor via `requireUserAuthContext` (session cookie or user API key); membership on room UUID; coworker API-key post-as-self on message POST where supported |

```
/v1/chats
├── /rooms
│   ├── GET|POST /
│   ├── GET|PATCH /{id}
│   ├── POST /{id}/read
│   ├── GET|POST /{id}/messages
│   └── POST /{id}/messages/{messageId}/reactions
├── /conversations          # deprecated
└── /stream
    ├── POST /
    └── GET /{conversationId}
```

**`POST /rooms`**

- `kind: "channel"` — create named channel (`name` / `slug`)
- `kind: "direct"` — create-or-get by participant set → `directKey`

List may filter with `?kind=`. Org from auth context (no required `?organizationId`).

## Database

Rename for clarity. One room table with `kind`. No provider-thread table. `conversation*` untouched.

### Migration (unmerged branch)

Delete these four migrations and ship **one** greenfield `chat_room*` migration (no ALTER rename chain):

- `20260725120000_add_chat_channels`
- `20260725185000_add_chat_channel_direct_messages`
- `20260725200500_add_chat_channel_threads_reactions`
- `20260726023000_add_chat_channel_read_states`

#### Release gate (hard cut)

**Not backward-compatible** with any database that applied the old four. Prod/`main` DBs that never saw those migrations are fine — `migrate deploy` just applies `20260727120000_add_chat_rooms`.

| Environment | Action before / with this release |
| --- | --- |
| Prod / main (never applied old four) | Deploy as usual |
| Local Postgres that ran `codex/chat-channels` with old migrations | `pnpm prisma:migrate:reset` (dev) then migrate, **or** drop DB and recreate |
| Neon agent / preview branch that applied old four | Delete/recreate the branch (or reset), then `pnpm prisma:migrate:deploy` |
| Shared staging that applied old four | Reset/redeploy that DB before Core activates this migration |

**Failure modes if you skip the gate:**

- `migrate deploy` errors on missing migration directories still listed in `_prisma_migrations`
- Orphan `chat_channel*` tables remain while app code only talks to `chat_room*`

Do **not** ship an ALTER-rename of the old tables — this release intentionally replaces the unmerged history. The SQL file header repeats this gate.
### Rename

| Today | Target |
| --- | --- |
| `chat_channel*` tables | `chat_room*` |
| Prisma `ChatChannel*` | `ChatRoom*` |
| FK `channelId` | `roomId` |

Product `kind` stays `'channel' \| 'direct'`.

### Shape

**`chat_room`** — `id` (uuid7), `organizationId` (Cascade), `name`, `slug`, `kind` (`channel` \| `direct`, default `channel`), `directKey?`, `topic?`, `archivedAt?`, `createdByUserId` (Restrict), timestamps.

- UNIQUE `(organizationId, slug)`, UNIQUE `(organizationId, directKey)`
- CHECK: direct ⇒ `directKey` set; channel ⇒ `directKey` null
- Indexes: `(organizationId, archivedAt, updatedAt)`, `(organizationId, kind, updatedAt)`

**Members** — `chat_room_user_member` / `chat_room_coworker_member`; UNIQUE `(roomId, userId|coworkerId)`; Cascade.

**`chat_room_message`** — `roomId`, optional `parentMessageId` (Cascade), `senderUserId` / `senderCoworkerId` (SetNull), `content`, `metadata?`.

- CHECK: at most one sender (`≤ 1`); both null OK after delete → API `sender.type: unknown`
- Indexes: `(roomId, createdAt)`, `(roomId, parentMessageId, createdAt)`, `(parentMessageId, createdAt)`

**`chat_room_reaction`** — UNIQUE `(messageId, userId, emoji)`. Keep `SELECT … FOR UPDATE` on message before toggle.

**`chat_room_read_state`** — UNIQUE `(roomId, userId)`, `lastReadAt`.

**`chat_room_mention`** — UNIQUE `(messageId, coworkerId)`; status `pending` → `sent` → `responded` \| `failed`; `providerConversationId` / `providerResponseId` (provider bridge only); optional unique `responseMessageId`. Do not overwrite `responded` with `failed`.

## Coworker

Unchanged: Core calls `baseURL` Conversations + Responses SSE; writes room replies itself (`senderCoworkerId`). Public DTOs need not mirror Responses.

## Implement (no separate plan)

1. Squash DB → `ChatRoom*` + one migration; `roomId` in DB and JSON
2. Mount `/v1/chats/rooms` (`POST /` both kinds); delete `/chat-channels`
3. Move conversations + stream under `/v1/chats/*`; delete old mounts
4. Regenerate web Core client; update web in the same release

## Deferred

- **Full absorb (product path superseded):** [2026-07-28 chat rooms cutover](./2026-07-28-chat-rooms-cutover-deprecate-conversations-design.md) ships room-keyed `/chat` UX and soft-deprecates `conversation*` in the product (no table drop, no history migration). Remaining follow-up: drop `conversation*` tables/models once restore/migration policy is decided.
- Group directs (multi-human / human+coworker) — directs are **1:1 only** until then
- Room-level `providerConversationId` — shipped on `ChatRoom` as the provider bridge; see cutover spec for stream/transcript ownership

## Org scope

- **Channels** require `organizationId` (active organization)
- **Coworker 1:1 directs** inherit the active organization when set; `organizationId` null only with no active org
- **Human 1:1 directs** require an active organization (teammate roster) and store that `organizationId`
- **List** returns only rooms for the active organization (no mix-in of personal/`null` rooms while an org is active)
