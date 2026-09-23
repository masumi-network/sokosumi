import { z } from "@hono/zod-openapi";

import { dateTimeSchema } from "@/helpers/datetime";

const operationIdSchema = z.uuid().openapi({
  description: "Browser-minted idempotency key for this operation",
  example: "123e4567-e89b-42d3-a456-426614174000",
});

const reasonSchema = z.string().trim().min(1).max(500).openapi({
  example: "Campaign completed",
});

export const projectCloseRequestSchema = z
  .object({
    operationId: operationIdSchema,
    expectedProjectRevision: z.number().int().nonnegative(),
    reason: reasonSchema.optional(),
  })
  .openapi("ProjectCloseRequest");

export const projectCloseRecoveryRequestSchema = z
  .object({
    operationId: operationIdSchema,
    expectedProjectRevision: z.number().int().nonnegative(),
    reason: reasonSchema,
  })
  .openapi("ProjectCloseRecoveryRequest");

export const projectCloseFailureSchema = z
  .object({
    seriesTaskId: z.string().nullable(),
    message: z.string(),
  })
  .openapi("ProjectCloseFailure");

export const projectCloseStatusSchema = z
  .object({
    id: z.uuid(),
    projectId: z.uuid(),
    state: z.enum(["CLOSING", "CLOSE_FAILED", "CLOSED"]),
    cutoffAt: dateTimeSchema,
    reason: z.string().nullable(),
    attempts: z.number().int().nonnegative(),
    failure: projectCloseFailureSchema.nullable(),
    completedAt: dateTimeSchema.nullable(),
    projectRevision: z.number().int().nonnegative(),
    owedOccurrenceCount: z.number().int().nonnegative(),
  })
  .openapi("ProjectCloseStatus");

export type ProjectCloseRequest = z.infer<typeof projectCloseRequestSchema>;
export type ProjectCloseRecoveryRequest = z.infer<
  typeof projectCloseRecoveryRequestSchema
>;
export type ProjectCloseStatus = z.infer<typeof projectCloseStatusSchema>;
