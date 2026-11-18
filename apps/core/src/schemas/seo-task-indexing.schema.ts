import { z } from "@hono/zod-openapi";

import { dateTimeSchema } from "@/helpers/datetime";
import {
  SEO_MAX_PAGES,
  seoIndexAssessmentSchema,
  seoIndexedPageSchema,
  seoUrlSchema,
} from "./project-seo.schema";
import { taskWorkerContextSchema } from "./task-worker-context.schema";

const hash = z.string().regex(/^[a-f0-9]{64}$/);
/** A retry keeps the original Google read time for each reused page. Only Core writes these timestamps. */
export const seoReusedInspectionTimesSchema = z.record(
  seoUrlSchema,
  z.iso.datetime(),
);

/** This finite bridge carries no credentials, query rows, or arbitrary provider operations. */
export const seoTaskIndexedPageSchema = seoIndexedPageSchema
  .extend({
    indexingState: seoIndexedPageSchema.shape.indexingState.unwrap(),
    pageFetchState: z.string().max(100).nullable(),
  })
  .strict()
  .openapi("SeoTaskIndexedPage");

export const seoTaskIndexingRequestSchema = z
  .strictObject({
    expectedContext: taskWorkerContextSchema,
    auditPageUrl: seoUrlSchema.optional(),
  })
  .openapi("SeoTaskIndexingRequest");

export const seoTaskIndexingReceiptSchema = z
  .strictObject({
    version: z.literal(1),
    taskId: z.string().min(1).max(128),
    receiptHash: hash,
    checkedAt: dateTimeSchema,
    auditPageUrl: seoUrlSchema.optional(),
    assessmentSaved: z.literal(true).optional(),
    status: z.enum([
      "available",
      "not_connected",
      "needs_property",
      "unavailable",
    ]),
    pages: z.array(seoTaskIndexedPageSchema).min(1).max(SEO_MAX_PAGES),
  })
  .openapi("SeoTaskIndexingReceipt");

export const seoTaskIndexingResultRequestSchema = seoTaskIndexingRequestSchema
  .extend({
    receiptHash: hash,
    assessments: z.array(seoIndexAssessmentSchema).min(1).max(SEO_MAX_PAGES),
  })
  .strict()
  .openapi("SeoTaskIndexingResultRequest");

/** Stored only in the requesting owner's private SEO observations. */
export const seoTaskIndexingResultSchema = z
  .strictObject({
    version: z.literal(1),
    taskId: z.string().min(1).max(128),
    receiptHash: hash,
    checkedAt: dateTimeSchema,
    auditPageUrl: seoUrlSchema.optional(),
    assessments: z
      .array(
        seoIndexAssessmentSchema.safeExtend({
          checkedAt: z.iso.datetime().optional(),
        }),
      )
      .min(1)
      .max(SEO_MAX_PAGES),
  })
  .openapi("SeoTaskIndexingResult");

export const seoTaskIndexingResultAcknowledgmentSchema =
  seoTaskIndexingReceiptSchema
    .pick({
      version: true,
      taskId: true,
      receiptHash: true,
    })
    .openapi("SeoTaskIndexingResultAcknowledgment");

export type SeoTaskIndexedPage = z.infer<typeof seoTaskIndexedPageSchema>;
export type SeoTaskIndexingReceipt = z.infer<
  typeof seoTaskIndexingReceiptSchema
>;
export type SeoTaskIndexingResultRequest = z.infer<
  typeof seoTaskIndexingResultRequestSchema
>;
export type SeoTaskIndexingResult = z.infer<typeof seoTaskIndexingResultSchema>;
