import { z } from "@hono/zod-openapi";

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

export const adminOrganizationSlugParamSchema = z.object({
  slug: z.string().openapi({
    param: { name: "slug", in: "path" },
    example: "acme-corp",
  }),
});
