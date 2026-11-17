import type { Hono } from "hono";

import { expireStalePendingInvitations } from "@/helpers/chat-room-invitation";
import prisma from "@/lib/db/prisma";

import { handleSyncRequest } from "../handler.js";

const CHAT_ROOM_GUEST_INVITATIONS_EXPIRE_SYNC_LOCK_KEY =
  "chat-room-guest-invitations-expire-sync";

export default function mount(app: Hono) {
  app.get("/chat-room-guest-invitations-expire", async (c) => {
    return await handleSyncRequest(
      c,
      CHAT_ROOM_GUEST_INVITATIONS_EXPIRE_SYNC_LOCK_KEY,
      async (context) => {
        // When already aborted (sync deadline), skip the write.
        const expired = context.abortSignal.aborted
          ? 0
          : await expireStalePendingInvitations(prisma, {
              now: new Date(),
            });

        context.log.set({ result: { expired } });
      },
      { errorDetail: "safe-fields" },
    );
  });
}
