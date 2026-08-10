import type { Hono } from "hono";

import { chatRoomGuestInvitationSyncService } from "@/services/chat-room-guest-invitation-sync.service";

import { handleSyncRequest } from "../handler.js";

export const CHAT_ROOM_GUEST_INVITATIONS_EXPIRE_SYNC_LOCK_KEY =
  "chat-room-guest-invitations-expire-sync";

export default function mount(app: Hono) {
  app.get("/chat-room-guest-invitations-expire", async (c) => {
    return await handleSyncRequest(
      c,
      CHAT_ROOM_GUEST_INVITATIONS_EXPIRE_SYNC_LOCK_KEY,
      async () => {
        console.info(
          "[sync/chat-room-guest-invitations-expire] Starting stale guest invitation expiry",
        );
        const startedAt = Date.now();
        const result =
          await chatRoomGuestInvitationSyncService.expireStaleGuestInvitations();

        console.info(
          "[sync/chat-room-guest-invitations-expire] Completed sync",
          {
            durationMs: Date.now() - startedAt,
            expired: result.expired,
          },
        );
      },
    );
  });
}
