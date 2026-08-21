# ADR 0013: Thread unread is Participant-gated

- Status: Accepted
- Date: 2026-08-21
- Supersedes: [ADR-0005](./0005-thread-unread-requires-prior-look.md) (including the SOK-811 `attentionReplyCount` override)

**Room unread** includes thread replies only when the viewer is a **Participant** of that Thread: they authored the parent, have a remaining reply, or are the target of a remaining **user mention** on the parent or a reply. Look clears; it does not opt a lurker in. A user mention makes them a Participant immediately.

**Why not look-gated unread (ADR-0005):** Look-as-eligibility pages people who only read someone else’s chain, which is what inflated the room. Parent authors and mentioned users never had to Look first — never-looked Participants still get unread (join-time clip, not all history).

**Why not a second thread number:** SOK-811’s `attentionReplyCount` / Threads badge existed to match lurker sidebar unread. With lurker replies gone from the room, that extra count has no job. Thread list still lists every Thread in the room; unread threads (Participant + uncleared replies) sort first. Sidebar chrome stays **bold** = room unread, **badge** = user mentions.

**Rejected:** lurker Looks create unread; mention is one-shot bold without becoming a Participant; mark room as read Looks Threads; mute blocks becoming a Participant; keep `attentionReplyCount` as a separate badge.

**Out of scope:** posting a Thread reply advancing **room** last-read (clears the main transcript). Reply **does** Look that Thread.

**Known limitation:** mute skipped CHAT mention notifications historically, so muted users who were only @mentioned before this ship are not backfilled as Participants. Going forward, mute still writes the durable mention row. Do not re-parse message bodies to recover those old pings.
