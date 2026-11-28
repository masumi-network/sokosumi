import { z } from "@hono/zod-openapi";

/** Kept beside env.ts, which is past the file size limit. */
export const seoImpactEnvShape = {
  // The daily /sync/seo-impact cron records done page changes and waits for Google's crawl.
  SEO_IMPACT_TRACKING_ENABLED: z
    .enum(["true", "false"])
    .default("false")
    .transform((value) => value === "true"),
  // The same cron prepares each measurable change and serves it to the SEO worker.
  SEO_IMPACT_DISPATCH_ENABLED: z
    .enum(["true", "false"])
    .default("false")
    .transform((value) => value === "true"),
  // An owner may crawl the next pages of a full audit's crawl. Off until the SEO bot that reads seo_crawl_next deploys.
  SEO_CRAWL_NEXT_ENABLED: z
    .enum(["true", "false"])
    .default("false")
    .transform((value) => value === "true"),
};
