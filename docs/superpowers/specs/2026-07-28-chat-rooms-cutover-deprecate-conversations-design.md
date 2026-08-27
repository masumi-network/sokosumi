# Chat rooms cutover: unify under `/chat`, deprecate conversations

**Date:** 2026-07-28  
**Status:** Approved for implementation  
**Related:** [2026-07-27-chats-api-and-chat-room-schema-design.md](./2026-07-27-chats-api-and-chat-room-schema-design.md)  
**Approach:** Rooms cutover, keep old `conversation*` rows (no history migration this phase)

## Goal

Make product messaging **100% Chat-Rooms**. One web home under `/chat`. Every open thread is `/chat/rooms/{roomId}` (channel or direct). Coworker AI streaming is room-keyed. Stop creating, listing, or navigating to `conversation*` from the product UI.

Old conversation data stays in the database for a possible later “restore old chats” effort. No data migration and no table drops in this phase.

## Non-goals

- Migrating `conversation` / `conversationMessage` rows into `chat_room_message`
- Dropping Prisma models or DB tables for `conversation*`
- Redirects from `/channels/*` (those routes are removed; bookmarks 404)
- Redirects from legacy `/chat/[bucket]/conversation/[id]` (404 or soft land on `/chat`; default **404**)
- Hermes / personal assistant
- Changing coworker Responses/Conversations protocol at `coworker.baseURL`
- Inventing a second uniqueness scheme beyond existing `directKey`
- Expanding directs beyond current product shapes (multi-coworker group directs stay out of scope)

## Context (today)

Two parallel systems:

| Surface | Storage | UX |
| --- | --- | --- |
| `/channels` + human/coworker room DMs | `chat_room*` | Org channels, human DMs, mention dispatch |
| `/chat` coworker AI | `conversation*` + `/v1/chats/stream` | Streaming AI; sidebar also lists coworker conversation history |

Bridge already exists: create-or-get `kind: "direct"` via `directKey`. Stream and transcript still largely live on `conversation*`.

## Product decisions (locked)

| Decision | Choice |
| --- | --- |
| Base path | `/chat` (reclaim landing; do not introduce `/chats`) |
| Open room | `/chat/rooms/{roomId}` for **both** channel and direct |
| URL split by kind | No — sidebar separates Channels vs Directs; `kind` drives chrome |
| Old `/channels` | Remove routes; **no redirects** |
| Conversations in UI | Remove completely |
| Old conversation DB rows | Keep; invisible |
| Direct identity | Keep existing `directKey` + create-or-get (as-is) |

## Routes & navigation

| Path | Role |
| --- | --- |
| `/chat` | Landing / empty state. Leftover `?create=channel` / `?dm=new` are ignored; Channel and Direct create overlay the current page (PR 3982). |
| `/chat/rooms/{roomId}` | Open room — channel or direct; UI from `kind` |

- **Landing:** `DEFAULT_AUTHENTICATED_LANDING_PATH` stays `"/chat"`.
- **Remove:** `apps/web` routes under `/channels` (no aliases).
- **Remove:** legacy conversation routes under `/chat/[bucketSlug]/conversation/[conversationId]` and related bucket-only conversation UX.
- **Sidebar:** Channels + Directs link only to `/chat/rooms/{roomId}`. No coworker rows that open `conversation*` paths.
- **History:** Hide or omit `HistoryKind.CONVERSATION` items (no deep links into dead URLs).
- **Notifications:** Prefer room links when a room exists; orphan conversation notification targets → drop/noop (no `/chat/.../conversation/...`).

## Web UI & shell

- One chat shell under `/chat`: move today’s channels experience into the `/chat` route tree (delete `/channels` pages).
- Shared room pane: header from `kind` (channel name/topic vs DM participants); message list, composer, threads, reactions.
- **Streaming UI:** coworker 1:1 (and any room stream path) streams tokens into the room transcript, bound to `roomId`.
- **Human-only rooms:** plain `POST` message (no stream), same as channels today.
- Solo coworker DM: create-or-get `kind: "direct"` → navigate `/chat/rooms/{roomId}` (never legacy conversation UI).
- Remove: conversation list / chat-ui conversations sidebar, `ConversationsProvider` if unused, bucket conversation routes.
- i18n: fold toward `App.Chat.*` (mechanical move from `App.Channels.*` acceptable).

## API, streaming, conversation deprecation

### Keep (rooms)

- `GET/POST /v1/chats/rooms`, `GET/PATCH /v1/chats/rooms/{id}`
- Messages, read, reactions
- Coworker @mention dispatch for channels (and multi-party where applicable)

### Streaming (new contract)

- Replace conversation-keyed stream with **room-keyed** stream, e.g.:
  - `POST /v1/chats/rooms/{id}/stream`
  - Resume `GET` if needed (same room id)
- Persist user + assistant turns as `chat_room_message` (coworker → `senderCoworkerId`).
- Provider bridge (`providerConversationId` / response ids) on **room** and/or existing `chat_room_mention` — not on `conversation*`.
- Web BFF (`/api/chat` or successor) calls room stream only.

### Soft-deprecate conversations

- **Web:** stop all product calls to conversation list/create/get/archive APIs; remove conversation actions and providers from the chat shell.
- **Core:** leave `/v1/chats/conversations*` OpenAPI-deprecated; unused by web after cutover. Remove or stop mounting conversation-keyed `/v1/chats/stream` once room stream owns the path (same release preferred if nothing else depends on it).
- **DB:** keep `conversation*` tables and rows. No migrate/drop this phase.

### Target API sketch

```
/v1/chats
├── /rooms
│   ├── GET|POST /
│   ├── GET|PATCH /{id}
│   ├── POST /{id}/read
│   ├── GET|POST /{id}/messages
│   ├── POST /{id}/messages/{messageId}/reactions
│   └── POST|GET /{id}/stream          # room-keyed AI stream
└── /conversations                     # deprecated; web unused
```

## Direct room identity (`directKey`) — keep as-is

Exactly one active direct room per participant set in a given org scope is already enforced. Do **not** add a parallel unique on `(userId, organizationId, coworkerId)` columns.

| Piece | Behavior |
| --- | --- |
| Field | `ChatRoom.directKey` (required when `kind = "direct"`) |
| Coworker 1:1 | `coworker:{userId}:{coworkerId}` via `buildDirectCoworkerRoomKey` |
| Human 1:1 | Sorted `userA:userB` |
| Mixed set | `direct:v2:…` sorted participant keys |
| Uniqueness | Partial unique `(organizationId, directKey)` when org set; `directKey` alone when `organizationId` is null |
| API | `POST /v1/chats/rooms` create-or-get + unique-race retry |

**Invariant for cutover:** coworker DM open path must create-or-get via existing `directKey`. Never create a second room for the same pair in the same org scope. Org is not embedded in the key string; it scopes the unique index (org A vs org B vs personal null-org are separate lanes).

Archive note (existing): archived rows still hold the `directKey` slot — create-or-get must unarchive-or-clear before reuse (already documented on rooms POST).

## Errors & edge cases

- Non-member `/chat/rooms/{roomId}` → rooms API 403/404; UI → `/chat` + toast/empty.
- No active org: channels blocked; coworker 1:1 direct allowed per existing org-scope rules.
- Stream: map billing/provider 403, 429, 5xx like current coworker stream; user message remains; failed assistant turn not marked success.
- Resume/reconnect keyed by `roomId`.
- Stale `/channels` or `/chat/.../conversation/...` bookmarks → **404** (no redirects).
- Old `conversation*` rows remain invisible; no auto-link into rooms this phase.
- Core must reject `coworkerIds.length > 1` on `kind: "direct"` create (include in this cutover if not already shipped).

## Testing

- **Core:** room stream creates/persists `chat_room_message`; membership checks; direct create-or-get + `directKey` race; no requirement for web to hit conversation APIs.
- **Web:** `/chat` landing; open `/chat/rooms/{id}`; drafts; sidebar → room URLs only; coworker DM never opens conversation UI.
- **Regression:** human DM + channel message without stream still work.

## Implementation outline (not a full plan)

1. Add room-keyed stream in Core; persist to `chat_room_message`; wire provider bridge off `conversation*`.
2. Point web BFF + room pane streaming at room stream.
3. Move channels UI under `/chat` / `/chat/rooms/{roomId}`; delete `/channels` routes.
4. Strip conversation UI, providers, history/notification deep links.
5. Leave Core conversation routes deprecated; stop web usage; optionally remove conversation stream mount when unused.
6. Regenerate web Core client after OpenAPI changes; typecheck.

## Success criteria

- No conversation list or conversation deep links in product UI.
- No new `conversation*` rows from product chat paths.
- Every open chat is `/chat/rooms/{roomId}`.
- Coworker AI replies stream inside that room.
- `directKey` create-or-get remains the sole identity for directs.
- Old conversation tables untouched (data preserved).

## Deferred

- Restore / migrate old conversation history into rooms for users who want it
- Drop `conversation*` schema once restore window is closed
- Optional vanity channel slugs in URLs (still open by `roomId` for now)
- Room-level `providerConversationId` cleanup if mention-level bridge is enough long-term
