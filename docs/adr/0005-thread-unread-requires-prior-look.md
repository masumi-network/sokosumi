# Thread unread requires a prior look

- Status: Superseded by [ADR-0012](./0012-thread-unread-is-participant-gated.md)

A **Thread** is an **unread thread** (`unreadReplyCount`) only if the user has already **looked** it and there is at least one non-self reply after that look. A never-looked Thread has `unreadReplyCount` 0 and sorts by last reply among non-attention rows.

**SOK-811 (product override):** Threads badge (`unread=true`), thread overview chrome, and Mark all use dual-baseline **`attentionReplyCount`**, which **does** include qualifying never-looked replies (same baseline as sidebar room unread). Do not re-gate the badge on ADR-0005 `unreadReplyCount` alone.

**Why look, not “any unseen reply” for `unreadReplyCount`:** with no look row, the baseline is room-join or the beginning of history, so old threads flood a prior-look-only unread list. That metric stays prior-look-only.

**Why not replied / participated:** unread means unseen activity in a Thread the user already chose to open. Requiring a reply (or parent authorship) blinds people who only read — including the parent author who never posts a reply.

**Out of scope:** changing room sidebar dual-baseline unread itself.

**Rejected for `unreadReplyCount`:** never-looked counts as prior-look unread; unread = I replied; unread = I authored the parent or replied.
