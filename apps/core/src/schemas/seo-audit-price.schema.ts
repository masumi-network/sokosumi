import { z } from "@hono/zod-openapi";
import {
  SEO_FULL_AUDIT_CREDITS,
  SEO_FULL_AUDIT_MARKUP_PERCENT,
  SEO_FULL_AUDIT_MAX_SECONDS,
  SEO_MIN_AUDIT_USD,
} from "@sokosumi/utils";

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
const count = z.number().int().nonnegative();
const detailText = z.string().min(1).max(SEO_COST_DETAIL_MAX_TEXT);
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
        microUsd: microUsd.nullable(),
      }),
    ),
    dataForSeo: detailRows(
      z.strictObject({
        endpoint: detailText,
        reads: count,
        microUsd,
      }),
    ),
    steps: detailRows(
      z.strictObject({
        step: detailText,
        modelMicroUsd: microUsd,
        dataForSeoMicroUsd: microUsd,
        otherApiMicroUsd: microUsd,
      }),
    ),
  })
  .openapi("SeoFullAuditCostDetail");
