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
        context.log.set({ result });
      },
      { errorDetail: "safe-fields" },
    );
  });
}
