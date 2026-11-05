import type { Hono } from "hono";

import { contactCaptureService } from "@/services/contact-capture.service";

import { handleSyncRequest } from "../handler.js";

export const CONTACT_CAPTURE_SYNC_LOCK_KEY = "contact-capture-sync";

/**
 * Every 15 minutes, beside the Soko Bot ingest: reads each connected
 * mailbox, calendar and Slack forward, continues their 12-month backfills,
 * and enriches the contacts that changed. Its own lock, so a long backfill
 * never delays a morning briefing.
 */
export default function mount(app: Hono) {
  app.get("/contact-capture", async (c) => {
    return await handleSyncRequest(
      c,
      CONTACT_CAPTURE_SYNC_LOCK_KEY,
      async (context) => {
        const result = await contactCaptureService.sync({
          shouldContinue: context.shouldContinue,
        });
        console.info("[sync/contact-capture] Completed sync", result);
      },
    );
  });
}
