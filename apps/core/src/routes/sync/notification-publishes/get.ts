import type { Hono } from "hono";

import { retryNotificationPublishes } from "@/services/notification-publish-sync.service";

import { handleSyncRequest } from "../handler.js";

export default function mount(app: Hono) {
  app.get("/notification-publishes", async (c) => {
    return handleSyncRequest(
      c,
      "notification-publishes-sync",
      async (context) => {
        const result = await retryNotificationPublishes({
          abortSignal: context.abortSignal,
          shouldContinue: context.shouldContinue,
        });
        console.info("[sync/notification-publishes] Completed sync", result);
      },
    );
  });
}
