# ADR 0019: Room unread chrome follows history resolved

- Status: Accepted
- Date: 2026-08-27

**Room last-read** advances when that room’s main transcript **history has resolved on screen** (messages loaded, or the room is confirmed empty)—for every membership-visible room. Unread chrome (list bold, mention badge, Chats tab presence, document title) must match **post-read truth on first paint**, including after mobile back-navigation remounts the list. The client treats the room as locally read at that moment; a failed write restores unread. A failed history load does not advance last-read. Manual mark-as-unread clears when history resolves.

**Why not on leave / list remount:** that is when mobile Chats is rebuilt from stale RSC, so unread snaps after the user already read. Last-read is a read event, not a navigation event.

**Why not wait for POST success:** back can happen while the write is in flight; the remounted list would still flash stale unread.

**Why leftover Thread unread stays bold:** [ADR-0013](./0013-thread-unread-is-participant-gated.md). Opening the room does not Look Threads. First paint is leftover-only unread, not the pre-read total and not a fully-read flash.

**Rejected:** advance last-read on route enter before history exists; on leave; after scroll-to-latest; Look every Thread on room open; optimistic fully-read then snap leftover; Instant Nav list-skeleton rewrite; transcript unread divider; numeric unread on the row.

**Out of scope:** making `/chat` skip Instant Nav skeleton.
