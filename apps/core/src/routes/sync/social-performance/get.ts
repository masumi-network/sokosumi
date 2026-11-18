import type { Hono } from "hono";
import { cleanExpiredZernioIntents } from "@/services/project-social-connections.service";
import { collectSocialPerformance } from "@/services/social-account-sync";
import { handleSyncRequest } from "../handler.js";

export default function mount(app: Hono) {
  app.get("/social-performance", (c) =>
    handleSyncRequest(
      c,
      "social-performance-sync",
      async (context) => {
        const shouldContinue = () =>
          context.shouldContinue() && context.msRemaining() > 15_000;
        const zernioIntents = await cleanExpiredZernioIntents({
          signal: context.abortSignal,
          shouldContinue,
        });
        const result = await collectSocialPerformance({
          abortSignal: context.abortSignal,
          shouldContinue,
        });
        context.log.set({
          result: {
            refreshed: result.accountsProcessed,
            failed: result.accountsFailed,
            ...result,
            zernioIntents,
          },
        });
      },
      { errorDetail: "safe-fields" },
    ),
  );
}
