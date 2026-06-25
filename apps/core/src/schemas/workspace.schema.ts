import { z } from "@hono/zod-openapi";

export const workspaceOrganizationSummarySchema = z.object({
  id: z.string().openapi({
    example: "11111111-1111-7111-8111-111111111111",
  }),
  name: z.string().openapi({ example: "Acme Labs" }),
  slug: z.string().openapi({ example: "acme-labs" }),
});

export const workspaceSummarySchema = z
  .object({
    id: z.uuid().openapi({
      example: "11111111-1111-7111-8111-111111111111",
    }),
    organizationId: z.string().nullable().openapi({ example: "org_123" }),
    organization: workspaceOrganizationSummarySchema.nullable(),
  })
  .openapi("WorkspaceSummary");

export const workspaceOrganizationSchema = z
  .object({
    organizationId: z.string().nullable().openapi({
      description:
        "Organization id for the workspace, or null for a personal workspace",
      example: "org_123",
    }),
  })
  .openapi("WorkspaceOrganization");
