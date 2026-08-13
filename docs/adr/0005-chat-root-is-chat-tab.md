# Chat root is the Chat tab

`/chat` is the authenticated **chat root** and the mobile **Chat tab**. Chat landing is not a separate non-tab root. Mobile shows Chat landing only when there are no membership-visible rooms (archived-only still the list). Desktop keeps landing + sidebar.

**Why one URL:** a tab the user cannot re-select is an orphan. `/chat/chats` redirects to `/chat`. Back from room, draft, and non-tab hubs goes to `/chat`. Instant on `/chat` stays landing-shaped (brief flash on mobile when the list will render). `?notice=room-unavailable` shows on whichever surface `/chat` paints.

**Rejected:** keep `/chat` as post-login-only; dynamic tab href; list stays at `/chat/chats` with landing as empty state of that path; cookie Instant.
