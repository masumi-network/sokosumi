# ADR 0040: Group name is separate from the stored room name

- Status: Accepted
- Date: 2026-09-23

A group Direct's **Group name** lives in its own nullable field on the chat room, not in `ChatRoom.name`. Null means unnamed: every client then shows the member list, as it does today.

**Why not `name`.** For a Direct, `name` is a snapshot written at creation from the creator's view of the other members ("Ben, Cara", "A, B, C and 2 more"). It leaves out the creator, keeps members who later left, and no client shows it; titles are built from live members. Every group Direct already holds a non-empty `name`, so reusing it would turn every existing snapshot into a Group name overnight, and a snapshot cannot be told from a name a member chose. Backfilling `name` to empty for Directs would have rewritten every row and still left the column meaning two things by kind.

**What `name` keeps doing.** It stays the Channel name and the Direct creation snapshot. The fallbacks that read it (notification fan-out when the per-reader title fails, Soko Bot `listChats` and room lookup) prefer the Group name when one is set.

**Editing a Direct.** `PATCH /v1/chats/rooms/{id}` rejected every Direct edit because a Direct's identity is its participant set. A Group name leaves `directKey` and membership untouched, so the route opens for that one field on group Directs only; members stay immutable.

**Change rows.** Each change leaves one sender-less status row (`metadata.groupNameChange`). Unlike joined/left rows, which count as Room unread, these rows are left out of the unread count: with no sender, the row would otherwise mark the room unread for the member who renamed it.

**Rejected:** reusing `name` with a flag saying whether it was chosen (two fields either way, and `name`'s meaning would still depend on the flag); a per-reader nickname (a Group name is shared by definition, see `CONTEXT.md`).
