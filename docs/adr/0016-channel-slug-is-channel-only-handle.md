# ADR 0016: Channel slug is a channel-only handle

- Status: Accepted
- Date: 2026-08-25

`ChatRoom.slug` is the **Channel slug**: unique per organization among Channels, null on Directs. Direct identity stays `directKey`. Create UI collects the handle first. The display name is derived from it (`team-soko` → `Team Soko`) and can be edited before submit. Core sanitizes the slug, **rejects** a taken handle, and derives the name from the slug when name is omitted. It does not silent-suffix (`team-soko-2`). After create, the slug is stable: renaming the Channel does not rewrite it.

**Why:** Product already uses slug as `#team-soko`, not as room identity. Org Directs derived from peer names were occupying the same unique index, so a coworker 1:1 named Elena stole `#elena` from a later Channel. Auto-suffix hid that. A handle the user can see and fix only works if uniqueness is channel-only and occupancy is honest (including private and archived Channels).

**Apply:**

- Partial unique `(organizationId, slug) WHERE kind = 'channel'`.
- CHECK: Channel requires slug; Direct requires slug null. Drop the personal-creator slug unique index.
- Channel create sends slug. Name is optional: omit/blank → derive title-case words from the slug. Taken → conflict, not “Room already exists” and not a suffix. The create wizard POSTs once after the member step so abandoning the dialog does not leave a Channel.
- Availability is a Core check against that unique index, not the membership-visible list.
- `#` Channel links and discoverable search stay Channel-only. Routing stays `/chat/rooms/{id}`.

**Rejected:** keeping a dummy Direct slug “for DTO uniformity”; shared uniqueness across kinds; silent suffix as the happy path; client-only availability against the sidebar; vanity slug URLs; stored `#` mention rows; editing slug after create (later, in channel settings).

**Out of scope:** freeing slugs held by memberless archived Channels.
