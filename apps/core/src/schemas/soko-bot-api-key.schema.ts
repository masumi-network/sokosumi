import { z } from "@hono/zod-openapi";

import { dateTimeSchema } from "@/helpers/datetime";

export const sokoBotApiKeySchema = z
  .object({
    id: z.string().openapi({ example: "agentkey_123" }),
    sokoBotId: z.string().uuid().openapi({
      example: "01960001-0001-7001-8001-000000000099",
    }),
    name: z.string().nullable().openapi({ example: "Production key" }),
    keyStart: z.string().openapi({ example: "orchestrator_abcdefgh" }),
    expiresAt: dateTimeSchema.nullable().openapi({
      example: "2026-12-31T23:59:59.000Z",
    }),
    revokedAt: dateTimeSchema.nullable().openapi({ example: null }),
    createdAt: dateTimeSchema,
    updatedAt: dateTimeSchema,
  })
  .openapi("SokoBotApiKey");

export const createSokoBotApiKeyResponseSchema = z
  .object({
    id: z.string().openapi({ example: "agentkey_123" }),
    token: z.string().openapi({ example: "orchestrator_very_secret_value" }),
    name: z.string().nullable().openapi({ example: "Production key" }),
    expiresAt: dateTimeSchema.nullable().openapi({
      example: "2026-12-31T23:59:59.000Z",
    }),
  })
  .openapi("CreateSokoBotApiKeyResponse");
