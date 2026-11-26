import type { Hono } from "hono";

import { getEnv } from "@/config/env";

import { syncSeoImpact } from "@/services/seo-impact.service";

import { handleSyncRequest } from "../handler.js";

const SEO_IMPACT_SYNC_LOCK_KEY = "seo-impact-sync";

/**
 * Records done page changes, then waits for Google's first crawl of each
 * page after its change. Does nothing while SEO_IMPACT_TRACKING_ENABLED is off.
 */
export default function mount(app: Hono) {
  app.get("/seo-impact", async (c) => {
    return await handleSyncRequest(
      c,
      SEO_IMPACT_SYNC_LOCK_KEY,
      async (context) => {
        const result = await syncSeoImpact(context);
        context.log.set({ result });
      },
      {
        errorDetail: "safe-fields",
        enabled: () => getEnv().SEO_IMPACT_TRACKING_ENABLED,
      },
    );
  });
}
