# ADR 0038: Room unread count is on by default

- Status: Accepted
- Date: 2026-09-22
- Supersedes the default in [ADR-0027](./0027-room-unread-count-is-a-reader-opt-in.md) (room unread count is a reader opt-in). Relates to [ADR-0037](./0037-thread-unread-leaves-room-unread.md) (thread unread leaves room unread).

A chat sidebar row shows its numeric **Room unread** unless the reader switched it off. ADR-0027 made that number an opt-in, off by default. It is now on by default, and the reader's switch in Settings turns it off.

**Why the default moved.** ADR-0027 held the number back for two reasons, and ADR-0037's work answered the first. The number used to fold in Thread replies the reader could not clear by reading the channel, so a count shown to everyone was a count many could not get rid of. It now counts top-level messages only, and reading the channel empties it. It also stopped competing with the mention badge: a row shows one number, the muted count or the `@` pill, never both. What is left of ADR-0027's caution is the second reason, recorded below as a known limitation.

**Stored as "hide", not as a new default on "show".** `showRoomUnreadCount` is `NOT NULL DEFAULT false`, so every existing reader holds `false`, and a reader who never chose cannot be told from one who switched the count off. Flipping that column's default would have meant rewriting every row and guessing at intent. The preference is a new column instead, `hideRoomUnreadCount`, `NOT NULL DEFAULT false`. Its `false`, which every reader starts with, means shown, so every reader lands on the new default with no backfill.

**The wire field keeps its name.** `GET` and `PATCH /v1/users/{id}/preferences` still speak `showRoomUnreadCount`. Core derives it as `!hideRoomUnreadCount` on read and stores the inverse on write. No client has to move, the Apple app included, and it picks up the new default with the rest. The web writes through Better Auth rather than that route, so it writes `hideRoomUnreadCount` directly and reads it off the session.

**A session that has not loaded reads as off.** Only the session knows whether this reader switched the count off, so the sidebar waits for it rather than flash a count at someone who said no. A session minted before the field existed carries no value for it; that reader never chose either, and gets the default.

**Expand only.** The old column stays in the table, neither read nor written, so a rollback finds every reader's old value where it left it. Removing it, and the Better Auth field declared for it, is a separate migration that needs its own authorization. Until then a reader who had opted in under ADR-0027 and a reader who had not are both simply shown the count.

**Known limitation, carried from ADR-0026 and ADR-0027:** an in-flight back-navigation can paint fully-read and then leftover, which a reader sees as the number moving once. Under ADR-0027 only readers who asked for the number saw that. Now everyone who has not switched it off does.

**Rejected:** flipping `showRoomUnreadCount`'s default and backfilling `true` (it cannot tell "never chose" from "chose off", and after the write nobody can); a nullable `showRoomUnreadCount` with null meaning default (the column is already non-null and populated, so every row would still need rewriting to null, with the same guess); removing the switch (a reader for whom the numbers are too much keeps a way out); renaming the wire field (it would break the Apple client for a name only Core's storage cares about).
