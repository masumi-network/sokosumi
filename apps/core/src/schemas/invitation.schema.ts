import { z } from "@hono/zod-openapi";

import { dateTimeSchema } from "@/helpers/datetime";

/**
 * Raw pending-invitation fields, mirroring the `Invitation` model. Used by the
 * owner/admin organization-invitations list endpoint.
 */
export const pendingInvitationSchema = z
  .object({
    id: z.string().openapi({ example: "inv_123" }),
    organizationId: z.string().openapi({ example: "org_123" }),
    email: z.string().openapi({ example: "jane@example.com" }),
    role: z.string().nullable().openapi({ example: "member" }),
    status: z.string().openapi({ example: "pending" }),
    expiresAt: dateTimeSchema,
    inviterId: z.string().openapi({ example: "user_123" }),
    createdAt: dateTimeSchema,
  })
  .openapi("PendingInvitation");

export const pendingInvitationsSchema = z.array(pendingInvitationSchema);

const invitationOrganizationSchema = z.object({
  id: z.string().openapi({ example: "org_123" }),
  name: z.string().openapi({ example: "Acme Inc" }),
  slug: z.string().openapi({ example: "acme-inc" }),
});

const invitationInviterSchema = z.object({
  id: z.string().openapi({ example: "user_123" }),
  email: z.string().openapi({ example: "owner@example.com" }),
});

const invitationWithRelationsSchema = pendingInvitationSchema.extend({
  organization: invitationOrganizationSchema,
  inviter: invitationInviterSchema,
});

export const userPendingInvitationsSchema = z
  .array(invitationWithRelationsSchema)
  .openapi("UserPendingInvitations");

/**
 * Result of resolving a pending invitation by id. Discriminated on `kind` so the
 * three not-usable cases stay distinguishable (the accept-invitation page renders
 * a different message per case) without overloading HTTP status codes.
 */
export const getInvitationResultSchema = z
  .discriminatedUnion("kind", [
    z.object({
      kind: z.literal("ok"),
      invitation: invitationWithRelationsSchema,
    }),
    z.object({ kind: z.literal("not_found") }),
    z.object({ kind: z.literal("expired") }),
    z.object({ kind: z.literal("inviter_not_found") }),
  ])
  .openapi("GetInvitationResult");
