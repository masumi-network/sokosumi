import { z } from "@hono/zod-openapi";

import {
  coworkerCapabilitiesSchema,
  coworkerMetadataSchema,
} from "@/schemas/coworker.schema";

const coworkerEditableFieldsSchema = z.object({
  name: z.string().trim().min(3).openapi({ example: "Ops Agent" }),
  caption: z
    .string()
    .trim()
    .min(1)
    .max(255)
    .nullish()
    .openapi({ example: "Senior Campaign Partner" }),
  url: z.httpUrl().nullish().openapi({ example: "https://example.com" }),
  baseURL: z.httpUrl().nullish().openapi({
    example: "https://responses.example.com/v1",
    description:
      "OpenAI Responses API base URL used to enable this coworker for chat.",
  }),
  description: z
    .string()
    .trim()
    .min(1)
    .nullish()
    .openapi({ example: "Ops helper" }),
  priority: z.number().int().optional().openapi({
    example: 10,
    description: "Admin only. Higher numbers sort first in coworker lists.",
  }),
  metadata: coworkerMetadataSchema.nullish(),
});

export const createCoworkerRequestSchema = coworkerEditableFieldsSchema.extend({
  vendorId: z.string().min(1).openapi({
    example: "01960001-0001-7001-8001-000000000001",
    description: "Vendor that owns this coworker.",
  }),
  capabilities: coworkerCapabilitiesSchema.optional().default([]),
});

export const patchCoworkerRequestSchema = coworkerEditableFieldsSchema
  .extend({
    capabilities: coworkerCapabilitiesSchema.optional(),
  })
  .partial()
  .strict()
  .refine(
    (data) =>
      data.name !== undefined ||
      data.caption !== undefined ||
      data.url !== undefined ||
      data.baseURL !== undefined ||
      data.description !== undefined ||
      data.capabilities !== undefined ||
      data.priority !== undefined ||
      data.metadata !== undefined,
    {
      message: "At least one coworker field is required",
      path: [
        "name",
        "caption",
        "url",
        "baseURL",
        "description",
        "capabilities",
        "priority",
        "metadata",
      ],
    },
  );

export const patchCoworkerWhitelistRequestSchema = z.object({
  isWhitelisted: z.boolean().openapi({ example: true }),
});
