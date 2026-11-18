# Room unread gets faster only with a schema change

- Status: Accepted
- Date: 2026-11-17

`sqlUnreadRoomMessages` in `apps/core/src/routes/v1/chats/rooms/room-unread.ts` finds a viewer's **Room unread** messages. One fragment feeds two callers: `getChatRoomUnreadCounts` and `getChatRoomFirstUnreadMessage`, which places the **Unread divider**. A message counts from `sqlMessageAttentionAt`: the later of its `createdAt` and the `updatedAt` of a `responded` `chat_room_mention` that names it as `responseMessageId`. An answer can arrive after the last read on a message created before it, so the query checks every top-level message in the room, read or not, with one mention lookup each.

`chat_room_mention` has no `roomId` and no index on `updatedAt`. So the query cannot find answers that arrived after the Room's last read without visiting every read message or every mention.

## Decisions

- **No more SQL-only rewrites.** Three rewrites were measured on a local Postgres 18 database (36,000 messages, 80 rooms for one viewer) against the query as it stands today. None was reliably faster. A split into two legs made the counts faster but made the divider query much slower, and gave no gain with 100,000 mentions. A `LEFT JOIN` in place of the subquery gave a small gain that disappeared with 100,000 mentions.
- **A real fix is a migration.** Either index the mention's responded time with its room, or store the answer time on the message.

## Considered Options

- **Two legs, one per room range and one driven from `chat_room_mention`.** Faster counts, slower divider.
- **`LEFT JOIN chat_room_mention` in place of the correlated subquery.** No gain at scale.

## Consequences

- A slow Room unread is not fixed in SQL alone. Propose a schema change first.
- Time any change on both callers, because they share one fragment.
- Base a production performance claim on an `EXPLAIN` of the query Core runs, not on a rewritten copy.
