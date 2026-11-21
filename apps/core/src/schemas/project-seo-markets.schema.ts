import { z } from "@hono/zod-openapi";

const share = z.number().finite().min(0).max(1);
const visits = z.number().int().nonnegative();
const maxProducts = 3;
export const SEO_MARKET_HOSTS_MAX = maxProducts + 1;
const maxRows = 100;
const count = z.number().int().min(0).max(maxProducts);
const marketHost = z
  .string()
  .max(253)
  .regex(
    /^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z](?:[a-z0-9-]{0,61}[a-z0-9])?$/i,
  );
export const seoMarketHost = z.object({
  host: marketHost,
  role: z.enum(["site", "product"]),
  etv: visits.nullable(),
  fetchedAt: z.iso.datetime({ offset: true }),
  unavailable: z.boolean(),
});
export const seoMarkets = z.object({
  rows: z
    .array(
      z.object({
        country: z.string().regex(/^[A-Z]{2}$/),
        language: z.string().regex(/^[a-z]{2,3}$/),
        start: z.boolean(),
        rivals: count,
        of: count.min(1),
        share,
        etv: visits,
        ownShare: share.nullable(),
        hasLanguage: z.boolean(),
        regionVersion: z
          .string()
          .regex(/^[a-z]{2,3}-[A-Z]{2}$/)
          .nullable(),
        candidate: z.boolean(),
      }),
    )
    .max(maxRows),
  outside: share.nullable(),
  siteVisits: z.boolean(),
  hosts: z.array(seoMarketHost).min(2).max(SEO_MARKET_HOSTS_MAX),
});
export const seoMarketNote = z.enum([
  "local_business",
  "missing_baseline",
  "time_limit",
  "budget_limit",
  "read_error",
  "unverified_competitors",
  "strategy_unavailable",
  "unavailable",
]);
