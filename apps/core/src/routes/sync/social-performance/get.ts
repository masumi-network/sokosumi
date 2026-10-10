import type { Hono } from "hono";
import { collectSocialPerformance } from "@/services/social-account-sync";
import { handleSyncRequest } from "../handler.js";

export default function mount(app: Hono) {
  app.get("/social-performance", (c) =>
    handleSyncRequest(c, "social-performance-sync", async (context) => {
      const result = await collectSocialPerformance({
        abortSignal: context.abortSignal,
        shouldContinue: () =>
          context.shouldContinue() && context.msRemaining() > 15_000,
      });
      console.info("[sync/social-performance-sync] collected", {
        refreshed: result.accountsProcessed,
        failed: result.accountsFailed,
        ...result,
      });
    }),
  );
}
