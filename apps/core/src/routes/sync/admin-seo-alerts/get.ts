import type { Hono } from "hono";

import { notifyAdminSeoAlerts } from "@/services/admin-seo-alert-notify";

import { handleSyncRequest } from "../handler.js";

const ADMIN_SEO_ALERTS_SYNC_LOCK_KEY = "admin-seo-alerts-sync";

export default function mount(app: Hono) {
  app.get("/admin-seo-alerts", async (c) => {
    return await handleSyncRequest(
      c,
      ADMIN_SEO_ALERTS_SYNC_LOCK_KEY,
      async (context) => {
        // When already aborted (sync deadline), skip the read and the writes.
        const result = context.abortSignal.aborted
          ? { critical: 0, read: 0, old: 0, capped: false, sent: 0 }
          : await notifyAdminSeoAlerts(context.shouldContinue);

        context.log.set({ result });
      },
      { errorDetail: "safe-fields" },
    );
  });
}
