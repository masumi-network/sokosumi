import { z } from "@hono/zod-openapi";

import { dateTimeSchema } from "@/helpers/datetime";

export const hermesInstanceStatusSchema = z
  .enum(["provisioning", "running", "suspended", "error"])
  .openapi("HermesInstanceStatus");

export const hermesInstanceSchema = z
  .object({
    status: hermesInstanceStatusSchema,
    endpointUrl: z.url().nullable(),
    lastActivityAt: dateTimeSchema.nullable(),
  })
  .openapi("HermesInstance");

/**
 * GET /hermes/me/instance payload. Discriminated union so OpenAPI clients never
 * run instance date transforms on JSON null (codegen bug with nullable object
 * + `dates: true`).
 */
export const hermesGetInstanceEnvelopeSchema = z
  .discriminatedUnion("hasInstance", [
    z
      .object({
        hasInstance: z.literal(false),
      })
      .openapi("HermesGetInstanceNone"),
    z
      .object({
        hasInstance: z.literal(true),
        instance: hermesInstanceSchema,
      })
      .openapi("HermesGetInstanceSome"),
  ])
  .openapi("HermesGetInstanceEnvelope");

export const hermesInstanceNotReadySchema = z
  .object({
    status: z.union([hermesInstanceStatusSchema, z.literal("missing")]),
  })
  .openapi("HermesInstanceNotReady");

export const hermesUploadedFileSchema = z
  .object({
    name: z.string().min(1),
    type: z.string().min(1),
    dataUrl: z.string().min(1),
  })
  .openapi("HermesUploadedFile");

export const hermesChatRequestSchema = z
  .object({
    content: z.string().optional(),
    files: z.array(hermesUploadedFileSchema).optional(),
  })
  .openapi("HermesChatRequest");

export const hermesChatMessageRoleSchema = z
  .enum(["user", "assistant", "system"])
  .openapi("HermesChatMessageRole");

export const hermesChatResponseSchema = z
  .object({
    message: z.object({
      role: z.literal("assistant"),
      content: z.string(),
    }),
  })
  .openapi("HermesChatResponse");

export const hermesPersistedMessageSchema = z
  .object({
    id: z.string().uuid(),
    role: hermesChatMessageRoleSchema,
    content: z.string(),
    kind: z.string().nullable(),
    createdAt: dateTimeSchema,
  })
  .openapi("HermesPersistedMessage");

export const hermesUnreadCountSchema = z
  .object({
    count: z.number().int().min(0),
  })
  .openapi("HermesUnreadCount");

export const markHermesInboxSeenRequestSchema = z
  .object({
    asOfIso: dateTimeSchema.optional(),
  })
  .openapi("MarkHermesInboxSeenRequest");

export const setHermesSecretRequestSchema = z
  .object({
    key: z.string().min(1),
    value: z.string(),
  })
  .openapi("SetHermesSecretRequest");

export const hermesEmptyResponseSchema = z
  .object({
    ok: z.literal(true),
  })
  .openapi("HermesEmptyResponse");
