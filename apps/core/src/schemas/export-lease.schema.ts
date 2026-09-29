import { z } from "@hono/zod-openapi";

export const exportLeaseTokenSchema = z.uuid();
export const exportLeaseSchema = z
  .object({
    token: exportLeaseTokenSchema,
    durationMs: z.number().int().positive(),
  })
  .openapi("ExportLease");
export const releaseExportLeaseBodySchema = z
  .object({
    token: exportLeaseTokenSchema,
  })
  .strict()
  .openapi("ReleaseExportLeaseBody");
export const releaseExportLeaseResponseSchema = z
  .object({
    released: z.boolean(),
  })
  .openapi("ReleaseExportLeaseResponse");
