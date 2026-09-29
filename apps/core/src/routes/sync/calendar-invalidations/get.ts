import type { Hono } from "hono";

import { calendarInvalidationOutboxService } from "@/services/calendar-invalidation-outbox.service";

import { handleSyncRequest } from "../handler.js";

const CALENDAR_INVALIDATIONS_SYNC_LOCK_KEY = "calendar-invalidations-sync";

export default function mount(app: Hono) {
  app.get("/calendar-invalidations", async (c) => {
    return await handleSyncRequest(
      c,
      CALENDAR_INVALIDATIONS_SYNC_LOCK_KEY,
      async (context) => {
        const result =
          await calendarInvalidationOutboxService.syncInvalidations({
            shouldContinue: context.shouldContinue,
          });
        console.info("[sync/calendar-invalidations] Completed sync", result);
      },
    );
  });
}
