# ADR 0027: Room unread count is a reader opt-in

- Status: Partially superseded by [ADR-0038](./0038-room-unread-count-is-on-
  by-default.md). The default, off, is superseded: the count is on unless the
  reader switches it off, stored as `hideRoomUnreadCount`. Everything else
  stands, in particular that the count is a field of its own beside the
  mention badge and never the badge's meaning.
- Date: 2026-09-07

A reader may switch on a numeric **Room unread** on chat sidebar rows. It is
one account-wide boolean on the user record, `showRoomUnreadCount`, **off by
default**. Switched on, a row with unread messages shows that count as muted
text beside the mention badge. Switched off, which is what every existing
reader gets, the row renders exactly as it did before. The count obeys the
suppression the rest of the row's chrome already obeys: no count on a muted
room. Opening a room does not hide it. Bold, badge, and count follow unread
state alone, so they go quiet only on a room that is read, marked read, or
muted. The browser tab title and the Chats presence dot
(`countChatRoomsWithUnreadAttention`) use the same predicate. The room-header
threads trigger follows the same rule: an open thread panel suppresses
nothing.

**What [ADR-0026](./0026-room-unread-chrome-follows-history-resolved.md)
rejected, and why this is allowed:** 0026 lists "numeric unread on the row"
in its Rejected line. That entry rejected a number shown to everyone, as the
row's default chrome, at a time when the number could not be trusted on first
paint. This is narrower on both counts. It is off unless a reader asks for it,
so no sidebar changes under anyone on upgrade; and it renders the same
`unreadCount` that already drives bold, so it cannot disagree with the bold
beside it. The known limitation 0026 records still applies and is unchanged:
an in-flight back-navigation can paint fully-read and then leftover. A reader
who opts in sees that as the number moving once, where a reader who does not
still sees bold clearing once.

**Why not switch the mention badge to count messages:** the badge counts user
mentions and direct messages, and a reader relies on it to tell a message
aimed at them from general volume. `CONTEXT.md` lists using the mention badge
as the message unread count under *Avoid* for **Room unread**. The count is
therefore a third field on `resolveRoomAttention` and separate text on the
row, so both numbers can sit on one row with neither changing what the other
says. [ADR-0013](./0013-thread-unread-is-participant-gated.md)'s chrome
sentence, bold means Room unread and badge means user mentions, stays true
word for word.

**Why not a per-room or per-workspace setting:** a per-room override needs a
store keyed by room and an affordance on every row, for a preference a reader
sets once. Account-wide rides the rail the sibling reader flags already ride:
a Prisma column, a Better Auth additional field, and the existing Core user
preferences route. Because it is a Better Auth additional field it reaches
the session the sidebar already holds, so a row costs no request and the
switch takes effect without a reload.

**Why not `NotificationPreference`:** that table is keyed by user, category,
and channel, and its meaning is delivery. This setting changes no delivery at
all. A row there would misreport what it does.

**Known limitation:** the count is capped at 99+, so the reader of a very loud
room learns that it is loud and not how loud. The cap is what keeps a
four-digit number from reflowing the row, and it matches the mention badge
beside it. If the volume itself turns out to be the thing readers want, the
cap is the first thing to revisit.

**Rejected:** switching `badgeCount` to `unreadCount`; renaming `MentionBadge`;
a second badge pill; a per-room override; a per-workspace variant; gating the
count on room kind; using the count as a sidebar sort input.

## Spent

An earlier draft suppressed the count on the open room via an `isActive`
early return on `resolveRoomAttention`. Opening a room does not read it, and
a room read leaves unlooked thread replies counted on purpose
(`apps/core/src/routes/v1/chats/rooms/[id]/read/post.ts`). Suppressing on
`isActive` hid real unread and brought the number back the moment the reader
clicked away. SOK-1048 removed that option. Do not restore it.

**Correction (2026-09-21, SOK-1147):** as written above, this ADR lets the
count and the mention badge sit on one row with neither changing what the
other says. A row now shows one number. Where there is a badge, it stands
alone and the count is not drawn; where there is none, the count shows as
before. Two numbers in two colours on one row asked the reader to work out
which was which, and the badge is the one addressed to them; bold still says
the room holds more. What each number counts is unchanged, which is the part
of this ADR that mattered: the badge still counts mentions and directs, the
count still counts Room unread, and `resolveRoomAttention` still reports them
as separate fields. The same rule holds on a Thread's inset row, which draws
its mention or its unread replies, never both. The sidebar's marks settled
into two in the same work. A muted number says how much is unread, the same
number in the same place for a channel, a Direct and a Thread's inset row. A
tinted primary pill with an `@` says the reader was named, matching the
collapsed rail's mention pill. Core counts every message toward the badge in a
Direct of two, so that row is written to rather than named: it draws the
number, not the pill, though the badge still bolds it and marks the rail.

**Out of scope:** which notifications are created or delivered, including
`CHAT_ROOM_MESSAGE` and its default; bringing `CHAT` into the Notification
Center.
