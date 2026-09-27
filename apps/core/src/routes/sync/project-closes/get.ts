import type { Hono } from "hono";

import { projectCloseSyncService } from "@/services/project-close-sync.service";

import { handleSyncRequest } from "../handler.js";

const PROJECT_CLOSES_SYNC_LOCK_KEY = "project-closes-sync";

export default function mount(app: Hono) {
  app.get("/project-closes", async (c) => {
    return await handleSyncRequest(
      c,
      PROJECT_CLOSES_SYNC_LOCK_KEY,
      async (context) => {
        const result = await projectCloseSyncService.syncProjectCloses({
          abortSignal: context.abortSignal,
          deadlineMs: context.deadlineMs,
          shouldContinue: context.shouldContinue,
        });
        console.info("[sync/project-closes] Completed sync", result);
      },
    );
  });
}
