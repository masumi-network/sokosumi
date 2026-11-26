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
