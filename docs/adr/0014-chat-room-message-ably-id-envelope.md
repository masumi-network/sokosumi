# ADR 0014: Chat room message Ably full DTO or id envelope

- Status: Accepted
- Date: 2026-08-24

Ably `chat_room_message` **create / update / delete** carry a full message DTO when that JSON fits Ably’s 64KB `maxMessageSize`. When it does not, Core publishes an **id envelope** `{ eventType, messageId, roomId, parentMessageId }` on the same event name and types — not a smaller fake DTO. Focused clients refetch via the existing room/thread message lists. Field patches (SOK-737) are unchanged.

**Why:** SOK-736 put unbounded assistant (and other) rows on a 64KB pipe. Thought stays on the DB row and on HTTP (ADR 0002). Silently dropping Thought or truncating `content` on the wire makes the client treat a lie as the message (`mergeRoomMessages` incoming-wins). Poll then “heals” only if it runs. Measure size **before** publish; never send an oversize body and never catch `40009` as a shrink fallback.

**Apply:**

- **Create / update** id envelope: do not invent a row. Focused room (and open thread when `parentMessageId` matches) runs the same HTTP refresh as the 3s live poll. Other attached rooms ignore the envelope, as they ignore full creates today.
- **Delete** id envelope: tombstone immediately by `messageId` if the row is on screen. List GET omits deleted rows; merge does not drop missing ids. Mapped deletes are already empty (`content: ""`, `metadata: null`) and should keep taking the full-DTO path after the size check.
- Old web clients that cannot parse the id envelope drop it; focused-room poll remains the compat backstop. Do not dual-publish full DTO plus envelope.
- Log when an id envelope is emitted (messageId, roomId, measured bytes). Not Sentry — this is an expected path.

**Rejected:** shrinking/truncating the full DTO until it fits; always-id-envelope (gives up snappy full creates); raising Ably account limits; a new `eventType`; a GET-by-id route; a placeholder bubble; `fitChatRoomMessageFullEvent` as a safety net.

**Out of scope:** product caps on assistant `content`; changing field patches.
