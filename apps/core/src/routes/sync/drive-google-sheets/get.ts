import type { Hono } from "hono";

import { refreshDueGoogleSheets } from "@/services/drive-google-sheet.service";

import { handleSyncRequest } from "../handler.js";

const DRIVE_GOOGLE_SHEETS_SYNC_LOCK_KEY = "drive-google-sheets-sync";

export default function mount(app: Hono) {
  app.get("/drive-google-sheets", async (c) => {
    return await handleSyncRequest(
      c,
      DRIVE_GOOGLE_SHEETS_SYNC_LOCK_KEY,
      async (context) => {
        const result = await refreshDueGoogleSheets({
          shouldContinue: context.shouldContinue,
        });
        if (result.refreshed + result.failed > 0)
          console.info(
            "[sync/drive-google-sheets] Refreshed Google Sheets",
            result,
          );
      },
    );
  });
}
