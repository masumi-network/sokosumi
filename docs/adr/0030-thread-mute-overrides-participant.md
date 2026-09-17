# ADR 0030: Thread mute overrides Participant

- Status: Accepted
- Date: 2026-09-16
- Relates to: [ADR-0013](./0013-thread-unread-is-participant-gated.md) (thread unread is Participant-gated)

A reader can **mute** one Thread. A muted Thread stops counting toward **Room unread** and stops writing CHAT notifications for that reader, even while they stay a **Participant**. Mute does not change who Participates: the parent author, the repliers, and the mentioned users are the same people before and after.

A **user mention** on a reply breaks through the mute. The reader is named, so that reply still counts and still writes its notification. Room mute silences it, as it silences everything else in that room.

The rule lives at two gates and nowhere else: the unread SQL predicate in `apps/core/src/routes/v1/chats/rooms/room-unread.ts`, and the recipient filter in `apps/core/src/helpers/chat-notification-fanout.ts`. A caller that fans out a reply passes `parentMessageId`; the mention fan-out leaves it out on purpose, which is how the break-through is expressed.

**Storage:** `mutedAt` on `chat_room_thread_read_state`, the row that already holds the reader's Look. Null means unmuted. There is no second table, because mute and Look are the same reader-and-Thread pair.

**Unmute also Looks the Thread.** Otherwise the silenced stretch replays: the Look baseline still sits at mute time, so every reply from the muted period arrives at once. Unmute means "page me from here", not "give me what I skipped".

Two cases keep their Look instead. A Thread that was not muted keeps it, because advancing there would clear real unread replies. A Thread that named the reader while it was muted keeps it too: that reply broke through and was never silenced, and one high-water mark cannot clear the chatter around it without clearing it as well. The chatter comes back with the mention, which is the side to err on.

**Rejected:** a thread mute that also drops the reader out of Participant (mute would then destroy a mention that arrives later); a separate mute table; letting mute swallow mentions too (a reader who is named has been addressed, not merely CC'd); replaying the muted stretch on unmute.
