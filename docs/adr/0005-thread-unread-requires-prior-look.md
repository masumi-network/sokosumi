# Thread unread requires a prior look

A **Thread** is an **unread thread** only if the user has already **looked** it and there is at least one non-self reply after that look. A never-looked Thread is not unread: it sorts by last reply only and does not count toward the Threads badge or mark-all.

**Why look, not “any unseen reply”:** with no look row, the baseline is room-join or the beginning of history, so old threads flood the top of a full **Thread list** as unread. That made the unread-only panel noisy and would break “unreads on top” on a full list.

**Why not replied / participated:** unread means unseen activity in a Thread the user already chose to open. Requiring a reply (or parent authorship) blinds people who only read — including the parent author who never posts a reply.

**Out of scope:** room sidebar dual-baseline unread still uses today’s thread look fallback (join / `-infinity`). Tightening that to match this rule is a follow-up.

**Rejected:** never-looked counts as unread; unread = I replied; unread = I authored the parent or replied; sort-only change that leaves the badge counting fossils.
