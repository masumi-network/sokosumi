import { z } from "@hono/zod-openapi";

import { SEO_MAX_PAGES, seoUrlSchema } from "./project-seo.schema";
import { taskWorkerContextSchema } from "./task-worker-context.schema";

// The SEO worker refuses a Task packet longer than this (seo-bot MAX_ANALYSIS_REQUEST_CHARS).
export const SEO_MAX_PACKET_CHARS = 32_768;

export const seoPageSelectionSchema = z.strictObject({
  version: z.literal(1),
  seedPageUrls: z.array(seoUrlSchema).min(1).max(SEO_MAX_PAGES),
  pageUrls: z.array(seoUrlSchema).min(1).max(SEO_MAX_PAGES),
});

export const seoTaskPagesRequestSchema = z
  .strictObject({
    expectedContext: taskWorkerContextSchema,
    seedPageUrls: z.array(seoUrlSchema).min(1).max(SEO_MAX_PAGES),
    relatedPageUrls: z.array(seoUrlSchema).max(SEO_MAX_PAGES),
  })
  .openapi("SeoTaskPagesRequest");

export const seoTaskPagesReceiptSchema = z
  .strictObject({
    version: z.literal(1),
    taskId: z.string().min(1).max(128),
    pageUrls: z.array(seoUrlSchema).min(1).max(SEO_MAX_PAGES),
  })
  .openapi("SeoTaskPagesReceipt");

export type SeoTaskPagesRequest = z.infer<typeof seoTaskPagesRequestSchema>;
