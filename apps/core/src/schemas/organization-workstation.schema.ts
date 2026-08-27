import { z } from "@hono/zod-openapi";

export const organizationWorkstationSchema = z
  .object({
    canUse: z.boolean().openapi({
      description:
        "Whether the caller may use the organization workstation (free orgs: all members; paid/enterprise: assigned Seat)",
      example: true,
    }),
  })
  .openapi("OrganizationWorkstation");
