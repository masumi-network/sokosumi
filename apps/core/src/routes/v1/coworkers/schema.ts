import { z } from "@hono/zod-openapi";

import {
  COWORKER_CAPABILITIES,
  normalizeCoworkerCapabilities,
} from "@/helpers/coworker-capability";

const coworkerCapabilitiesSchema = z
  .array(z.enum(COWORKER_CAPABILITIES))
  .transform((capabilities) => normalizeCoworkerCapabilities(capabilities))
  .openapi({
    example: ["chat", "tasks"],
    description:
      "Enabled coworker capabilities. Empty array means the coworker has no enabled capabilities.",
  });

const coworkerEditableFieldsSchema = z.object({
  name: z.string().trim().min(3).openapi({ example: "Ops Agent" }),
  caption: z
    .string()
    .trim()
    .min(1)
    .max(255)
    .nullish()
    .openapi({ example: "Senior Campaign Partner" }),
  company: z
    .string()
    .trim()
    .min(1)
    .max(255)
    .nullish()
    .openapi({ example: "Serviceplan" }),
  companyLogo: z
    .httpUrl()
    .nullish()
    .openapi({ example: "https://example.com/company-logo.png" }),
  url: z.httpUrl().nullish().openapi({ example: "https://example.com" }),
  baseURL: z
    .httpUrl()
    .nullish()
    .openapi({
      example: "https://responses.example.com/v1",
      description:
        "OpenAI Responses API base URL used to enable this coworker for chat.",
    }),
  email: z.email().openapi({ example: "ops@example.com" }),
  description: z
    .string()
    .trim()
    .min(1)
    .nullish()
    .openapi({ example: "Ops helper" }),
  image: z
    .httpUrl()
    .nullish()
    .openapi({ example: "https://example.com/logo.png" }),
});

export const createCoworkerRequestSchema = coworkerEditableFieldsSchema.extend({
  capabilities: coworkerCapabilitiesSchema.optional().default([]),
});

export const patchCoworkerRequestSchema = coworkerEditableFieldsSchema
  .extend({
    capabilities: coworkerCapabilitiesSchema.optional(),
  })
  .partial()
  .refine(
    (data) =>
      data.name !== undefined ||
      data.caption !== undefined ||
      data.company !== undefined ||
      data.companyLogo !== undefined ||
      data.url !== undefined ||
      data.baseURL !== undefined ||
      data.email !== undefined ||
      data.description !== undefined ||
      data.capabilities !== undefined ||
      data.image !== undefined,
    {
      message: "At least one coworker field is required",
      path: [
        "name",
        "caption",
        "company",
        "companyLogo",
        "url",
        "baseURL",
        "email",
        "description",
        "capabilities",
        "image",
      ],
    },
  );

export const patchCoworkerWhitelistRequestSchema = z.object({
  isWhitelisted: z.boolean().openapi({ example: true }),
});
