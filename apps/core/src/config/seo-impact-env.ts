import { z } from "@hono/zod-openapi";

/** Kept beside env.ts, which is past the file size limit. */
export const seoImpactEnvShape = {
  // The daily /sync/seo-impact cron records done page changes and waits for Google's crawl.
  SEO_IMPACT_TRACKING_ENABLED: z
    .enum(["true", "false"])
    .default("false")
    .transform((value) => value === "true"),
};
