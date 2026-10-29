import type { Hono } from "hono";

import { reconcileAvatarRenders } from "@/services/soko-bot-avatar-render.service";

import { handleSyncRequest } from "../handler.js";

const SOKO_BOT_AVATAR_RENDERS_SYNC_LOCK_KEY = "soko-bot-avatar-renders-sync";

export default function mount(app: Hono) {
  app.get("/soko-bot-avatar-renders", async (c) => {
    return await handleSyncRequest(
      c,
      SOKO_BOT_AVATAR_RENDERS_SYNC_LOCK_KEY,
      async ({ shouldContinue }) => {
        const result = await reconcileAvatarRenders({ shouldContinue });
        console.info("[sync/soko-bot-avatar-renders] Completed sync", result);
      },
    );
  });
}
