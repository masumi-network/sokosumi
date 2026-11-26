import { z } from "@hono/zod-openapi";

import { SEO_MAX_PAGES, seoUrlSchema } from "./seo-page.schema";

export const publicSitemapInputFields = {
  publicSitemapUrl: seoUrlSchema.max(2048).optional(),
  sitemapPageHints: z
    .array(seoUrlSchema.max(2048))
    .min(1)
    .max(SEO_MAX_PAGES)
    .optional(),
};
export const MAX_AUDIT_SITEMAPS = 50;
export const sitemapAddress = z
  .string()
  .max(2048)
  .url()
  .refine((s) => {
    if (!URL.canParse(s)) return false;
    const url = new URL(s);
    return (
      ["https:", "http:"].includes(url.protocol) &&
      !url.username &&
      !url.password &&
      !url.hash
    );
  });
const count = z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER);
export const sitemapEvidenceSchema = z.object({
  path: sitemapAddress,
  type: z.string().max(64).nullable(),
  index: z.boolean(),
  pending: z.boolean().nullable(),
  submittedAt: z.iso.datetime().nullable(),
  downloadedAt: z.iso.datetime().nullable(),
  errors: count.nullable(),
  warnings: count.nullable(),
  webUrls: count.nullable(),
});
export const auditIndexReadSchema = z.object({
  page: sitemapAddress,
  reason: z.string().max(500).nullable(),
  verdict: z.string().max(64),
  canonical: sitemapAddress.nullable(),
  crawledAt: z.string().max(64).nullable(),
  checkedAt: z.iso.datetime(),
  reportedSitemaps: z.array(sitemapAddress).max(8).optional(),
  referringPages: z.array(sitemapAddress).max(8).optional(),
});
export const auditDiscoverySchema = z.object({
  checkedAt: z.iso.datetime(),
  status: z.enum(["available", "partial", "unavailable"]),
  sitemaps: z.array(sitemapEvidenceSchema).max(MAX_AUDIT_SITEMAPS),
  inspections: z.array(auditIndexReadSchema).max(10),
  changes: z
    .array(
      z.object({
        url: sitemapAddress,
        previousDay: z.iso.date(),
        currentDay: z.iso.date().optional(),
        text: z.string().max(700),
      }),
    )
    .max(60),
});
export type AuditDiscovery = z.infer<typeof auditDiscoverySchema>;
