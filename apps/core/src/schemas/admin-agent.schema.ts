import { z } from "@hono/zod-openapi";

import { dateTimeSchema } from "@/helpers/datetime";
import { agentStatusSchema } from "@/schemas/domain-enums.schema";
import { cursorPaginationQuerySchema } from "@/schemas/pagination.schema";

export const adminAgentListSortBySchema = z
  .enum(["displayName", "registryName", "hasOverride", "status", "createdAt"])
  .default("createdAt")
  .openapi({
    param: { name: "sortBy", in: "query" },
    description: "Column to sort the admin agent list by",
    example: "createdAt",
  });

export const adminAgentListSortOrderSchema = z
  .enum(["asc", "desc"])
  .default("desc")
  .openapi({
    param: { name: "sortOrder", in: "query" },
    description: "Sort direction for the admin agent list",
    example: "desc",
  });

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
  status: agentStatusSchema.optional().openapi({
    param: { name: "status", in: "query" },
    description: "Filter agents by registry status (omit for all)",
    example: "ONLINE",
  }),
  sortBy: adminAgentListSortBySchema,
  sortOrder: adminAgentListSortOrderSchema,
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
    status: agentStatusSchema,
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
    status: agentStatusSchema,
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
      authorName: z.string().nullable(),
      authorImage: z.string().nullable(),
      authorContactEmail: z.string().nullable(),
      authorContactOther: z.string().nullable(),
      authorOrganization: z.string().nullable(),
      legalPrivacyPolicy: z.string().nullable(),
      legalDpa: z.string().nullable(),
      legalTerms: z.string().nullable(),
      legalOther: z.string().nullable(),
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

/**
 * Same rules as Masumi agent client (`getAgentApiBaseUrl`): http(s), no query,
 * no hash. Empty / null clears the override.
 */
const nullableApiBaseUrlField = nullableStringField.superRefine(
  (value, ctx) => {
    if (value === undefined || value === null) {
      return;
    }

    let url: URL;
    try {
      url = new URL(value);
    } catch {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "API base URL must be a valid absolute URL",
      });
      return;
    }

    if (url.protocol !== "https:" && url.protocol !== "http:") {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "API base URL must be HTTP or HTTPS",
      });
    }
    if (url.search !== "") {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "API base URL must not have a query string",
      });
    }
    if (url.hash !== "") {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "API base URL must not have a hash",
      });
    }
  },
);

export const patchAdminAgentMetadataOverrideBodySchema = z
  .object({
    name: nullableStringField,
    description: nullableStringField,
    apiBaseUrl: nullableApiBaseUrlField,
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
