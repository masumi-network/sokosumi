import { z } from "@hono/zod-openapi";
import {
  SEO_CRAWL_NEXT_MIN_CREDITS,
  SEO_FULL_AUDIT_CREDITS,
  SEO_FULL_AUDIT_MARKUP_PERCENT,
  SEO_FULL_AUDIT_MAX_SECONDS,
  SEO_MIN_AUDIT_USD,
} from "@sokosumi/utils";
import { seoSnapshotIdSchema } from "./seo-site-crawl.schema";

export const seoFullAuditLimitsSchema = z
  .object({
    usd: z.number().min(SEO_MIN_AUDIT_USD).max(50),
    // 90 minutes: the worker contract accepts this owner-set site limit (owner, 2026-11-13).
    seconds: z.number().int().min(60).max(SEO_FULL_AUDIT_MAX_SECONDS),
  })
  .strict();

export const seoCostPlusPriceSchema = z.strictObject({
  kind: z.literal("cost_plus"),
  version: z.literal(1),
  minimumCredits: z.literal(SEO_FULL_AUDIT_CREDITS),
  markupPercent: z.literal(SEO_FULL_AUDIT_MARKUP_PERCENT),
  // Only the separately purchased CMO subscription retains its fixed amount.
  maxCredits: z.literal(SEO_FULL_AUDIT_CREDITS).optional(),
});

/** A crawl continuation's terms: the bot refuses any other, and there is no cap. */
export const seoCrawlNextPriceSchema = z.strictObject({
  kind: z.literal("cost_plus"),
  version: z.literal(1),
  minimumCredits: z.literal(SEO_CRAWL_NEXT_MIN_CREDITS),
  markupPercent: z.literal(SEO_FULL_AUDIT_MARKUP_PERCENT),
});

export const storedSeoFullAuditPriceSchema = z.discriminatedUnion("kind", [
  z.strictObject({
    kind: z.literal("fixed"),
    credits: z.literal(SEO_FULL_AUDIT_CREDITS),
  }),
  seoCostPlusPriceSchema,
]);

const microUsd = z.number().int().nonnegative();
export const seoFullAuditCostSchema = z.strictObject({
  version: z.literal(1),
  gatewayMicroUsd: microUsd,
  directModelMicroUsd: microUsd,
  dataForSeoMicroUsd: microUsd,
  otherApiMicroUsd: microUsd,
});

const SEO_COST_DETAIL_MAX_ROWS = 200;
const SEO_COST_DETAIL_MAX_TEXT = 200;
/** USD 1M per row keeps 200-row sums exact in a JS number. */
const SEO_COST_DETAIL_MAX_MICRO_USD = 1_000_000_000_000;
/** PostgreSQL jsonb cannot store NUL or an unpaired surrogate; such text would fail the settlement write. */
const UNSTORABLE_TEXT = /[\0\p{Cs}]/u;
const count = z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER);
const detailMicroUsd = microUsd.max(SEO_COST_DETAIL_MAX_MICRO_USD);
const detailText = z
  .string()
  .min(1)
  .max(SEO_COST_DETAIL_MAX_TEXT)
  .refine((text) => !UNSTORABLE_TEXT.test(text))
  // A refine is not published, so the description states the rule for clients.
  .openapi({
    description:
      "1 to 200 characters, with no NUL character and no unpaired UTF-16 surrogate.",
  });
const detailRows = <T extends z.ZodType>(row: T) =>
  z.array(row).max(SEO_COST_DETAIL_MAX_ROWS);

/** Display-only breakdown of a full-audit receipt. It never changes the charge. */
export const seoFullAuditCostDetailSchema = z
  .strictObject({
    version: z.literal(1),
    models: detailRows(
      z.strictObject({
        model: detailText,
        provider: detailText.nullable(),
        calls: count,
        // null: a call with no known price (a direct, non-Gateway call).
        microUsd: detailMicroUsd.nullable(),
      }),
    ),
    dataForSeo: detailRows(
      z.strictObject({
        endpoint: detailText,
        reads: count,
        microUsd: detailMicroUsd,
      }),
    ),
    steps: detailRows(
      z.strictObject({
        step: detailText,
        modelMicroUsd: detailMicroUsd,
        dataForSeoMicroUsd: detailMicroUsd,
        otherApiMicroUsd: detailMicroUsd,
      }),
    ),
  })
  .openapi("SeoFullAuditCostDetail");

/** A request to crawl the next pages of a full audit's crawl, after the person approves the price. */
export const requestSeoCrawlNextSchema = z
  .strictObject({
    /** The crawl Snapshot to go on from: the workspace's `availableActions.continueCrawlFrom`. */
    continues: seoSnapshotIdSchema,
    price: seoCrawlNextPriceSchema,
    idempotencyKey: z.string().trim().min(8).max(128),
  })
  .openapi("RequestSeoCrawlNext");
export type RequestSeoCrawlNext = z.infer<typeof requestSeoCrawlNextSchema>;
