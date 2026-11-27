import type { Hono } from "hono";

import { getEnv } from "@/config/env";

import { syncSeoImpact } from "@/services/seo-impact.service";
import { prepareSeoImpactInputs } from "@/services/seo-impact-prepare";

import { handleSyncRequest } from "../handler.js";

const SEO_IMPACT_SYNC_LOCK_KEY = "seo-impact-sync";
/** Kept back from the inspections, so final windows reach the worker on a busy day too. Not calibrated. */
const PREPARE_RESERVE_MS = 60_000;
/** A short tick keeps back at most this share of it, so the inspections also run. Not calibrated. */
const PREPARE_RESERVE_SHARE = 0.5;

/**
 * Records done page changes, then waits for Google's first crawl of each
 * page after its change. With SEO_IMPACT_DISPATCH_ENABLED, it then prepares
 * each change whose window is final for the SEO worker. Does nothing while
 * SEO_IMPACT_TRACKING_ENABLED is off.
 */
export default function mount(app: Hono) {
  app.get("/seo-impact", async (c) => {
    return await handleSyncRequest(
      c,
      SEO_IMPACT_SYNC_LOCK_KEY,
      async (context) => {
        const reserve = getEnv().SEO_IMPACT_DISPATCH_ENABLED
          ? Math.min(
              PREPARE_RESERVE_MS,
              context.msRemaining() * PREPARE_RESERVE_SHARE,
            )
          : 0;
        const result = await syncSeoImpact({
          shouldContinue: () =>
            context.shouldContinue() && context.msRemaining() > reserve,
          msRemaining: () => Math.max(0, context.msRemaining() - reserve),
        });
        const prepare = await prepareSeoImpactInputs(context);
        context.log.set({ result, prepare });
      },
      {
        errorDetail: "safe-fields",
        enabled: () => getEnv().SEO_IMPACT_TRACKING_ENABLED,
      },
    );
  });
}
