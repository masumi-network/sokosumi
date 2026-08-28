import type { Hono } from "hono";

import { stockAvatarPool } from "@/services/soko-bot-avatar.service";

import { handleSyncRequest } from "../handler.js";

export const SOKO_BOT_AVATARS_SYNC_LOCK_KEY = "soko-bot-avatars-sync";

export default function mount(app: Hono) {
  app.get("/soko-bot-avatars", async (c) => {
    return await handleSyncRequest(
      c,
      SOKO_BOT_AVATARS_SYNC_LOCK_KEY,
      async () => {
        const result = await stockAvatarPool();
        console.info("[sync/soko-bot-avatars] Completed sync", result);
      },
    );
  });
}
