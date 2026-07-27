import { z } from "@hono/zod-openapi";

import { dateTimeSchema } from "@/helpers/datetime";

export const createOrganizationInviteLinkRequestSchema = z
  .object({
    /** Days until the link expires (1–90). Defaults to 7. */
    expiresInDays: z.number().int().min(1).max(90).default(7).optional(),
    /** Cap on total joins. Null/omitted = unlimited until expiry. */
    maxUses: z.number().int().min(1).max(10_000).nullable().optional(),
  })
  .openapi("CreateOrganizationInviteLinkRequest");

export const organizationInviteLinkSchema = z
  .object({
    token: z.string(),
    /** Full shareable URL (`{webBase}/join/{token}`). */
    url: z.string().url(),
    role: z.string(),
    expiresAt: dateTimeSchema,
    revokedAt: dateTimeSchema.nullable(),
    maxUses: z.number().int().nullable(),
    useCount: z.number().int(),
  })
  .openapi("OrganizationInviteLink");

/** Public preview for the /join page — never leaks org data for bad tokens. */
export const resolveOrganizationInviteLinkResponseSchema = z
  .object({
    status: z.enum(["valid", "expired", "revoked", "depleted", "not_found"]),
    organization: z
      .object({
        name: z.string(),
        slug: z.string(),
        logo: z.string().nullable(),
      })
      .nullable(),
  })
  .openapi("ResolveOrganizationInviteLink");

export const acceptOrganizationInviteLinkResponseSchema = z
  .object({
    status: z.enum(["joined", "already_member"]),
    organizationSlug: z.string(),
    organizationId: z.string(),
  })
  .openapi("AcceptOrganizationInviteLink");
