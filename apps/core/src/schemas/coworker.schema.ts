import { z } from "@hono/zod-openapi";

import {
  COWORKER_CAPABILITIES,
  normalizeCoworkerCapabilities,
} from "@/helpers/coworker-capability";
import { dateTimeSchema } from "@/helpers/datetime.js";

export const coworkerCapabilitiesSchema = z
  .array(z.enum(COWORKER_CAPABILITIES))
  .transform((capabilities) => normalizeCoworkerCapabilities(capabilities))
  .openapi({
    example: ["chat", "tasks"],
    description:
      "Enabled coworker capabilities. Empty array means the coworker has no enabled capabilities.",
  });

export const coworkerSchema = z
  .object({
    id: z.string().openapi({ example: "cow_123" }),
    createdAt: dateTimeSchema,
    updatedAt: dateTimeSchema,
    archivedAt: dateTimeSchema.nullable(),
    isWhitelisted: z.boolean().openapi({ example: true }),
    slug: z.string().openapi({ example: "ops-agent" }),
    name: z.string().openapi({ example: "Ops Agent" }),
    caption: z
      .string()
      .nullish()
      .openapi({ example: "Senior Campaign Partner" }),
    company: z.string().nullish().openapi({ example: "Serviceplan" }),
    companyLogo: z
      .string()
      .nullish()
      .openapi({ example: "https://example.com/company-logo" }),
    url: z.string().nullish().openapi({ example: "https://example.com" }),
    baseURL: z.string().nullable().openapi({
      example: "https://responses.example.com/v1",
      description:
        "OpenAI Responses API base URL used to enable this coworker for chat.",
    }),
    email: z.string().nullish().openapi({ example: "ops@example.com" }),
    description: z.string().nullish().openapi({ example: "Ops helper" }),
    capabilities: coworkerCapabilitiesSchema,
    image: z
      .string()
      .nullish()
      .openapi({ example: "https://example.com/logo" }),
  })
  .openapi("Coworker");
