import { z } from "@hono/zod-openapi";

/**
 * The user's preferred (last active) organization workspace.
 *
 * `organizationId` is `null` for the personal workspace. Used both as the
 * write payload and the response of `PUT /v1/users/{id}/preferred-organization`.
 * The key is required: send `{"organizationId":null}`, not `{}`.
 */
export const preferredOrganizationSchema = z
  .object({
    organizationId: z.string().nullable().openapi({
      example: "org_123",
      description:
        'Organization id of the preferred workspace, or null for personal. The key is required: send {"organizationId":null} for personal. Omitting it (`{}`) is 422.',
    }),
  })
  .openapi("PreferredOrganization");

export type PreferredOrganization = z.infer<typeof preferredOrganizationSchema>;
