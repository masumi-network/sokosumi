import { z } from "@hono/zod-openapi";

import { dateTimeSchema } from "@/helpers/datetime";
import { cursorPaginationQuerySchema } from "@/schemas/pagination.schema";

export const adminSearchQuerySchema = z.object({
  query: z
    .string()
    .optional()
    .openapi({
      param: { name: "query", in: "query" },
      description:
        "Search term matched against name and email (users) or name and slug (organizations). Empty or whitespace-only queries return an empty list.",
      example: "acme",
    }),
});

export const adminUserOptionSchema = z
  .object({
    id: z.string().openapi({ example: "user_123" }),
    name: z.string().openapi({ example: "Ada Lovelace" }),
    email: z.string().openapi({ example: "ada@example.com" }),
  })
  .openapi("AdminUserOption");

export const adminUserSearchResponseSchema = z.array(adminUserOptionSchema);

export const adminOrganizationOptionSchema = z
  .object({
    id: z.string().openapi({ example: "org_123" }),
    name: z.string().openapi({ example: "Acme Corp" }),
    slug: z.string().openapi({ example: "acme-corp" }),
  })
  .openapi("AdminOrganizationOption");

export const adminOrganizationSearchResponseSchema = z.array(
  adminOrganizationOptionSchema,
);

export const adminUserOverviewQuerySchema = z
  .object({
    query: z
      .string()
      .optional()
      .openapi({
        param: { name: "query", in: "query" },
        description:
          "Optional search term matched case-insensitively against user name and email. Empty or missing lists all users.",
        example: "ada",
      }),
  })
  .extend(cursorPaginationQuerySchema.shape);

export const adminUserOverviewItemSchema = z
  .object({
    id: z.string().openapi({ example: "user_123" }),
    name: z.string().openapi({ example: "Ada Lovelace" }),
    email: z.string().openapi({ example: "ada@example.com" }),
    createdAt: dateTimeSchema,
    credits: z.number().openapi({
      description: "Available personal credits",
      example: 42.5,
    }),
    subscriptionPlan: z.string().nullable().openapi({
      description: "Active subscription plan, if any",
      example: "pro",
    }),
    subscriptionStatus: z.string().nullable().openapi({ example: "active" }),
    startedTaskCount: z.number().int().min(0).openapi({
      description: "Number of tasks the user has started (status beyond DRAFT)",
      example: 7,
    }),
  })
  .openapi("AdminUserOverviewItem");

export const adminUserOverviewListSchema = z.array(adminUserOverviewItemSchema);

export const adminOrganizationSlugParamSchema = z.object({
  slug: z.string().openapi({
    param: { name: "slug", in: "path" },
    example: "acme-corp",
  }),
});
