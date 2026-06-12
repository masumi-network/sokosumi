import { z } from "@hono/zod-openapi";

/**
 * The user's preferred (last active) organization workspace.
 *
 * `organizationId` is `null` for the personal workspace. Used both as the
 * write payload and the response of `PUT /v1/users/{id}/preferred-organization`.
 */
export const preferredOrganizationSchema = z
  .object({
    organizationId: z.string().nullable().openapi({
      example: "org_123",
      description:
        "Organization id of the preferred workspace, or null for the personal workspace",
    }),
  })
  .openapi("PreferredOrganization");

export type PreferredOrganization = z.infer<typeof preferredOrganizationSchema>;
