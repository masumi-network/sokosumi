import type { Hono } from "hono";

import { captchaPassPurgeService } from "@/services/captcha-pass.purge";

import { handleSyncRequest } from "../handler.js";

const CAPTCHA_PASSES_PURGE_SYNC_LOCK_KEY = "captcha-passes-purge-sync";

export default function mount(app: Hono) {
  app.get("/captcha-passes-purge", async (c) => {
    return await handleSyncRequest(
      c,
      CAPTCHA_PASSES_PURGE_SYNC_LOCK_KEY,
      async (context) => {
        console.info(
          "[sync/captcha-passes-purge] Starting expired captcha pass purge",
        );
        const startedAt = Date.now();
        const result = await captchaPassPurgeService.purgeExpiredCaptchaPasses({
          abortSignal: context.abortSignal,
        });

        console.info("[sync/captcha-passes-purge] Completed sync", {
          durationMs: Date.now() - startedAt,
          purged: result.purged,
        });
      },
    );
  });
}
