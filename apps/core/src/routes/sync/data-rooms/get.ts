import type { Hono } from "hono";

import { moveDataRoomFiles } from "@/services/data-room.service";

import { handleSyncRequest } from "../handler.js";

const DATA_ROOMS_SYNC_LOCK_KEY = "data-rooms-sync";

export default function mount(app: Hono) {
  app.get("/data-rooms", async (c) => {
    return await handleSyncRequest(
      c,
      DATA_ROOMS_SYNC_LOCK_KEY,
      async (context) => {
        const result = await moveDataRoomFiles({
          shouldContinue: context.shouldContinue,
        });
        if (result.rooms > 0)
          console.info("[sync/data-rooms] Moved data room files", result);
      },
    );
  });
}
