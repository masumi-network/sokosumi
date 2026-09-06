# Thread unread requires a prior look

- Status: Superseded by [ADR-0013](../0013-thread-unread-is-participant-gated.md)
- Archived: live number 0005 is [optional personal workspace](../0005-optional-personal-workspace.md)

A **Thread** is an **unread thread** (`unreadReplyCount`) only if the user has already **looked** it and there is at least one non-self reply after that look. A never-looked Thread has `unreadReplyCount` 0 and sorts by last reply among non-attention rows.

**SOK-811 (historical only, superseded by ADR-0013):** Threads badge (`unread=true`), thread overview chrome, and Mark all used dual-baseline **`attentionReplyCount`**, which included qualifying never-looked replies. Do not treat this as the live rule.

**Why look, not “any unseen reply” for `unreadReplyCount`:** with no look row, the baseline is room-join or the beginning of history, so old threads flood a prior-look-only unread list. That metric stays prior-look-only.

**Why not replied / participated:** unread means unseen activity in a Thread the user already chose to open. Requiring a reply (or parent authorship) blinds people who only read — including the parent author who never posts a reply.

**Out of scope:** changing room sidebar dual-baseline unread itself.

**Rejected for `unreadReplyCount`:** never-looked counts as prior-look unread; unread = I replied; unread = I authored the parent or replied.
