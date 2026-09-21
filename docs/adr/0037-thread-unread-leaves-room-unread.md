# ADR 0037: Thread unread leaves Room unread

- Status: Accepted
- Date: 2026-09-21
- Relates to: [ADR-0013](./0013-thread-unread-is-participant-gated.md) (thread unread is Participant-gated), [ADR-0027](./0027-room-unread-count-is-a-reader-opt-in.md) (room unread count is a reader opt-in), [ADR-0030](./0030-thread-mute-overrides-participant.md) (thread mute overrides Participant)

**Room unread** counted non-self top-level messages *and* non-self replies in Threads the reader **Participates** in, as one number. **Room last-read** clears only the first half, by design: advancing the main transcript does not **Look** a Thread. A reader who opened every channel and read to the bottom was left with a number that the action they had just taken could not clear, and nothing anywhere in the channel pointed at the replies holding it up. The number was correct and unactionable at the same time.

We had listed "a separate Threads badge" under *Avoid* to stop the sidebar growing a second number competing with the mention badge. That guarded the right thing and prescribed the wrong remedy: it kept the count honest by folding it into a row that could not discharge it.

**Room unread counts top-level messages only.** Thread unread is its own number, carried beside it on the room summary, and it surfaces on the **Thread** rather than on the channel. Reading a channel now empties that channel's mark, which is the entire point.

**A user mention inside a Thread still marks the channel.** Being named is not chatter, and a reader who is addressed should not have to open a panel to find out. This is the one escalation; an ordinary reply never reaches the row.

**Participant, Look and Mute gating are unchanged.** No new counting rule is introduced here. The thread leg of the unread query already carries ADR-0013's Participant predicate and ADR-0030's mute predicate, and keeps carrying them verbatim; an existing sum is separated into its two addends and nothing else moves. A **Muted thread** contributes to neither number, and a mention inside one still breaks through to both.

The rule lives at two gates and nowhere else: the `GROUP BY` in `getChatRoomUnreadCounts` (`apps/core/src/routes/v1/chats/rooms/room-unread.ts`), which reports its two `UNION ALL` legs separately instead of summing them, and `resolveRoomAttention` (`apps/web/src/components/chat/room-attention.ts`), which bolds a row from the channel leg plus the mention count. A caller that reads `unreadCount` still gets the total; the halves are additive fields, so `apps/apple` is unaffected.

**Thread unread gets three places to be seen**, because a number with no destination is what we are fixing. The parent message's reply affordance becomes an unread state in the main transcript. The sidebar renders unread Threads inset under their channel, capped at three with an overflow row into the thread list — the cap is the price of keeping the channel list a list of channels. The **Thread list** panel, which already sorts unread first, is that overflow target. On the collapsed rail, where a row is only its mark, the same inset rows ride a flyout beside that mark in place of the room's name tooltip. The flyout is a pointer surface; from the keyboard or on a touch rail the rows are reached by expanding the sidebar. The **Rail attention pill** keeps its vocabulary: a thread-only room shows none, a Thread mention shows the mention pill.

**Storage:** nothing new. `ChatRoomThreadReadState` already holds the Look and the mute, and it is already written when a Thread is opened. This ADR changes how two stored numbers are reported, not what is stored.

**Rejected:** keeping the fold and adding only the unread reply bar (the bar cannot be seen without scrolling to the parent, so the sidebar number still strands the reader); clearing Thread unread on room mark-read (that is ADR-0013's rejected look-gating in another costume, and it discards replies the reader never saw); letting the mention badge carry Thread unread (the badge counts mentions and directs and must keep saying so); an uncapped inset list (the channel list stops being one, and rows shift under the cursor as replies land); a cross-room Threads inbox as part of this change (a bigger reversal — the **Thread list** is per-room by decision — and it reads better once Thread unread is already a first-class number).
