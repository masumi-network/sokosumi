# Sidebar Pin API is star; UI stays Pin

Pinned messages are a shared Channel list. The personal sidebar preference was also called Pin, so the API would have used “pin” for both. Membership `pinnedAt` and `POST/DELETE /chats/rooms/{id}/pin` become `starredAt` and `POST/DELETE /chats/rooms/{id}/star`. The sidebar still shows Pin / Unpin and the pin icon.

Rejected: renaming the sidebar action to Star; keeping `pinnedAt` on the room DTO next to pinned-message fields.
