import { z } from "@hono/zod-openapi";

import { dateTimeSchema } from "@/helpers/datetime";
import { cursorPaginationQuerySchema } from "@/schemas/pagination.schema";

export const adminAgentListQuerySchema = cursorPaginationQuerySchema.extend({
  q: z
    .string()
    .trim()
    .min(1)
    .optional()
    .openapi({
      param: { name: "q", in: "query" },
      description:
        "Optional search on registry name, blockchain identifier, or override name",
      example: "research",
    }),
});

export const adminAgentIdParamSchema = z.object({
  id: z.string().openapi({
    param: { name: "id", in: "path" },
    description: "Agent ID",
    example: "agent_123",
  }),
});

export const adminAgentMetadataOverrideExampleSchema = z
  .object({
    name: z.string().min(1),
    mimeType: z.string().min(1),
    url: z.string().min(1),
  })
  .openapi("AdminAgentMetadataOverrideExample");

export const adminAgentMetadataOverrideSchema = z
  .object({
    name: z.string().nullable(),
    description: z.string().nullable(),
    apiBaseUrl: z.string().nullable(),
    capabilityName: z.string().nullable(),
    capabilityVersion: z.string().nullable(),
    authorName: z.string().nullable(),
    authorImage: z.string().nullable(),
    authorContactEmail: z.string().nullable(),
    authorContactOther: z.string().nullable(),
    authorOrganization: z.string().nullable(),
    legalPrivacyPolicy: z.string().nullable(),
    legalDpa: z.string().nullable(),
    legalTerms: z.string().nullable(),
    legalOther: z.string().nullable(),
    image: z.string().nullable(),
    tags: z.array(z.string()),
    exampleOutputs: z.array(adminAgentMetadataOverrideExampleSchema),
  })
  .nullable()
  .openapi("AdminAgentMetadataOverride");

export const adminAgentRegistrySchema = z
  .object({
    id: z.string(),
    blockchainIdentifier: z.string(),
    name: z.string(),
    description: z.string().nullable(),
    apiBaseUrl: z.string(),
    capabilityName: z.string().nullable(),
    capabilityVersion: z.string().nullable(),
    authorName: z.string().nullable(),
    authorImage: z.string().nullable(),
    authorContactEmail: z.string().nullable(),
    authorContactOther: z.string().nullable(),
    authorOrganization: z.string().nullable(),
    legalPrivacyPolicy: z.string().nullable(),
    legalDpa: z.string().nullable(),
    legalTerms: z.string().nullable(),
    legalOther: z.string().nullable(),
    image: z.string().nullable(),
    icon: z.string().nullable(),
    status: z.string(),
    isShown: z.boolean(),
    createdAt: dateTimeSchema,
    updatedAt: dateTimeSchema,
  })
  .openapi("AdminAgentRegistry");

export const adminAgentListItemSchema = z
  .object({
    id: z.string(),
    blockchainIdentifier: z.string(),
    registryName: z.string(),
    hasOverride: z.boolean(),
    displayName: z.string(),
    displayImage: z.string().nullable(),
    status: z.string(),
    isShown: z.boolean(),
    createdAt: dateTimeSchema,
    updatedAt: dateTimeSchema,
  })
  .openapi("AdminAgentListItem");

export const adminAgentListSchema = z
  .array(adminAgentListItemSchema)
  .openapi("AdminAgentList");

export const adminAgentDetailSchema = z
  .object({
    registry: adminAgentRegistrySchema,
    override: adminAgentMetadataOverrideSchema,
    resolved: z.object({
      name: z.string(),
      description: z.string().nullable(),
      image: z.string().nullable(),
      apiBaseUrl: z.string(),
      tags: z.array(z.string()),
      exampleOutputs: z.array(adminAgentMetadataOverrideExampleSchema),
    }),
  })
  .openapi("AdminAgentDetail");

const nullableStringField = z
  .string()
  .nullish()
  .transform((value) => {
    if (value === undefined) {
      return undefined;
    }
    if (value === null) {
      return null;
    }
    const trimmed = value.trim();
    return trimmed === "" ? null : trimmed;
  });

export const patchAdminAgentMetadataOverrideBodySchema = z
  .object({
    name: nullableStringField,
    description: nullableStringField,
    apiBaseUrl: nullableStringField,
    capabilityName: nullableStringField,
    capabilityVersion: nullableStringField,
    authorName: nullableStringField,
    authorImage: nullableStringField,
    authorContactEmail: nullableStringField,
    authorContactOther: nullableStringField,
    authorOrganization: nullableStringField,
    legalPrivacyPolicy: nullableStringField,
    legalDpa: nullableStringField,
    legalTerms: nullableStringField,
    legalOther: nullableStringField,
    image: nullableStringField,
    tags: z.array(z.string().trim().min(1)).optional(),
    exampleOutputs: z.array(adminAgentMetadataOverrideExampleSchema).optional(),
  })
  .openapi("PatchAdminAgentMetadataOverrideBody");

export const deleteAdminAgentMetadataOverrideResponseSchema = z
  .object({
    override: z.null(),
  })
  .openapi("DeleteAdminAgentMetadataOverrideResponse");
