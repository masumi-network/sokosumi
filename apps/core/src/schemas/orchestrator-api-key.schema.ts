import { z } from "@hono/zod-openapi";

import { dateTimeSchema } from "@/helpers/datetime";

function isFutureDateTime(value: string): boolean {
  return new Date(value).getTime() > Date.now();
}

export const orchestratorApiKeySchema = z
  .object({
    id: z.string().uuid().openapi({
      example: "01960001-0001-7001-8001-0000000000aa",
    }),
    orchestratorId: z.string().uuid().openapi({
      example: "01960001-0001-7001-8001-000000000099",
    }),
    name: z.string().nullable().openapi({ example: "Production key" }),
    keyStart: z.string().openapi({ example: "orch_abcdefgh" }),
    expiresAt: dateTimeSchema.nullable().openapi({
      example: "2026-12-31T23:59:59.000Z",
    }),
    revokedAt: dateTimeSchema.nullable().openapi({ example: null }),
    createdAt: dateTimeSchema,
    updatedAt: dateTimeSchema,
  })
  .openapi("OrchestratorApiKey");

export const createOrchestratorApiKeyResponseSchema = z
  .object({
    id: z.string().uuid().openapi({
      example: "01960001-0001-7001-8001-0000000000aa",
    }),
    token: z.string().openapi({ example: "orch_very_secret_value" }),
    name: z.string().nullable().openapi({ example: "Production key" }),
    expiresAt: dateTimeSchema.nullable().openapi({
      example: "2026-12-31T23:59:59.000Z",
    }),
  })
  .openapi("CreateOrchestratorApiKeyResponse");

export const createOrchestratorApiKeyRequestSchema = z
  .object({
    name: z
      .string()
      .trim()
      .min(1)
      .max(120)
      .nullish()
      .openapi({ example: "Production key" }),
    expiresAt: dateTimeSchema.nullable().optional().openapi({
      example: "2026-12-31T23:59:59.000Z",
    }),
  })
  .superRefine((data, ctx) => {
    if (
      data.expiresAt !== undefined &&
      data.expiresAt !== null &&
      !isFutureDateTime(data.expiresAt)
    ) {
      ctx.addIssue({
        code: "custom",
        message: "expiresAt must be in the future",
        path: ["expiresAt"],
      });
    }
  });

export const updateOrchestratorApiKeyRequestSchema = z
  .object({
    name: z
      .string()
      .trim()
      .min(1)
      .max(120)
      .nullish()
      .openapi({ example: "Rotating key" }),
    expiresAt: dateTimeSchema.nullable().optional().openapi({
      example: "2027-01-01T00:00:00.000Z",
    }),
  })
  .refine((data) => data.name !== undefined || data.expiresAt !== undefined, {
    message: "At least one of name or expiresAt is required",
    path: ["name", "expiresAt"],
  })
  .superRefine((data, ctx) => {
    if (
      data.expiresAt !== undefined &&
      data.expiresAt !== null &&
      !isFutureDateTime(data.expiresAt)
    ) {
      ctx.addIssue({
        code: "custom",
        message: "expiresAt must be in the future",
        path: ["expiresAt"],
      });
    }
  });
