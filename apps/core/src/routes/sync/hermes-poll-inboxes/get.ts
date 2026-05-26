import type { Hono } from "hono";

import { hermesInboxSyncService } from "@/services/hermes-inbox-sync.service";

import { handleSyncRequest } from "../handler.js";

export const HERMES_POLL_INBOXES_SYNC_LOCK_KEY = "hermes-poll-inboxes-sync";

export default function mount(app: Hono) {
  app.get("/hermes/poll-inboxes", async (c) => {
    return await handleSyncRequest(
      c,
      HERMES_POLL_INBOXES_SYNC_LOCK_KEY,
      async (context) => {
        console.info("[sync/hermes/poll-inboxes] Polling Hermes inboxes");
        const startedAt = Date.now();
        const summary = await hermesInboxSyncService.pollInboxes({
          abortSignal: context.abortSignal,
          deadlineMs: context.deadlineMs,
          shouldContinue: context.shouldContinue,
        });

        console.info(
          `[sync/hermes/poll-inboxes] Completed sync (status=${summary.status}, polled=${summary.polled}, totalMessages=${summary.totalMessages}, durationMs=${Date.now() - startedAt})`,
          summary.breakdown,
        );
      },
    );
  });
}
