import crypto from "node:crypto";

import { createRoute, z } from "@hono/zod-openapi";
import { MemberRole } from "@sokosumi/database";
import { organizationInviteLinkRepository } from "@sokosumi/database/repositories";

import { getWebAppBaseUrl } from "@/config/env";
import { jsonErrorResponse, jsonSuccessResponse } from "@/helpers/openapi";
import { resolveMemberOrganizationById } from "@/helpers/organization";
import { created } from "@/helpers/response";
import prisma from "@/lib/db/prisma";
import type { OpenAPIHonoWithAuth } from "@/lib/hono";
import { requireUserContext } from "@/middleware/auth";
import {
  createOrganizationInviteLinkRequestSchema,
  organizationInviteLinkSchema,
} from "@/schemas/organization-invite-link.schema";

const params = z.object({
  id: z.string().openapi({
    param: { name: "id", in: "path" },
    description: "Organization ID",
    example: "org_123",
  }),
});

const route = createRoute({
  method: "post",
  path: "/{id}/invite-links",
  description:
    "Create a shareable, email-agnostic invite link for an organization. Anyone signed in who opens the link may join as a member (subject to the org's billing seat gate). Owners and admins only.",
  tags: ["Organizations"],
  request: {
    params,
    body: {
      content: {
        "application/json": {
          schema: createOrganizationInviteLinkRequestSchema,
        },
      },
    },
  },
  responses: {
    201: jsonSuccessResponse(
      organizationInviteLinkSchema,
      "The created invite link",
    ),
    401: jsonErrorResponse("Unauthorized"),
    403: jsonErrorResponse("Forbidden - owner or admin only"),
    404: jsonErrorResponse("Not Found - Organization not found"),
    500: jsonErrorResponse("Internal Server Error"),
  },
});

export default function mount(app: OpenAPIHonoWithAuth) {
  app.openapi(route, async (c) => {
    const userContext = requireUserContext(c.var.authContext);
    const { id } = c.req.valid("param");
    const body = c.req.valid("json");

    const { organization } = await resolveMemberOrganizationById({
      id,
      userId: userContext.userId,
      tx: prisma,
      allowedRoles: [MemberRole.OWNER, MemberRole.ADMIN],
    });

    const token = crypto.randomBytes(24).toString("base64url");
    const expiresInDays = body.expiresInDays ?? 7;
    const expiresAt = new Date(
      Date.now() + expiresInDays * 24 * 60 * 60 * 1000,
    );
    const maxUses = body.maxUses ?? null;

    const link = await organizationInviteLinkRepository.createInviteLink(
      {
        token,
        organizationId: organization.id,
        role: MemberRole.MEMBER,
        createdByUserId: userContext.userId,
        expiresAt,
        maxUses,
      },
      prisma,
    );

    return created(
      c,
      organizationInviteLinkSchema.parse({
        token: link.token,
        url: `${getWebAppBaseUrl()}/join/${link.token}`,
        role: link.role,
        expiresAt: link.expiresAt.toISOString(),
        revokedAt: link.revokedAt?.toISOString() ?? null,
        maxUses: link.maxUses,
        useCount: link.useCount,
      }),
    );
  });
}
