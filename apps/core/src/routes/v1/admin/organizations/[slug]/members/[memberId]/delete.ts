import { createRoute } from "@hono/zod-openapi";
import { OrganizationOwnerRetentionError } from "@sokosumi/database/helpers";
import { memberRepository } from "@sokosumi/database/repositories";

import { getAdminOrganizationBySlug } from "@/helpers/admin-organization-overview.js";
import {
  applyOrganizationExitChatRevocation,
  type OrganizationExitChatRevocationResult,
  publishOrganizationExitChatRevocation,
} from "@/helpers/chat-room-organization-exit";
import { badRequest, notFound } from "@/helpers/error";
import { jsonErrorResponse } from "@/helpers/openapi";
import prisma from "@/lib/db/prisma";
import type { OpenAPIHonoWithAuth } from "@/lib/hono";
import { adminOrganizationMemberIdParamSchema } from "@/schemas/admin.schema";

const route = createRoute({
  method: "delete",
  path: "/{slug}/members/{memberId}",
  operationId: "removeAdminOrganizationMember",
  description: "Remove a member from an organization (admin only).",
  tags: ["Admin"],
  request: {
    params: adminOrganizationMemberIdParamSchema,
  },
  responses: {
    204: {
      description: "Member removed",
    },
    400: jsonErrorResponse("Bad Request"),
    401: jsonErrorResponse("Unauthorized"),
    403: jsonErrorResponse("Forbidden"),
    404: jsonErrorResponse("Not Found"),
  },
});

export default function mount(app: OpenAPIHonoWithAuth) {
  app.openapi(route, async (c) => {
    const { slug, memberId } = c.req.valid("param");

    const organization = await getAdminOrganizationBySlug(slug, prisma);
    if (!organization) {
      throw notFound("Organization not found");
    }

    const member = await memberRepository.getMemberByIdAndOrganizationId(
      memberId,
      organization.id,
      prisma,
    );
    if (!member) {
      throw notFound("Member not found");
    }

    let chatRevocation: OrganizationExitChatRevocationResult = {
      revokedRoomIds: [],
      statusMessages: [],
    };
    try {
      // Hard-leave rooms before deleting the Member row (same order as BA
      // beforeRemoveMember). Member DELETE also fires the DB hard-leave
      // trigger (covers BA leaveOrganization, which has no hooks) — no-op
      // when app already cleaned.
      chatRevocation = await prisma.$transaction(async (tx) => {
        const revocation = await applyOrganizationExitChatRevocation(
          tx,
          member.userId,
          organization.id,
        );
        await memberRepository.removeMember(memberId, organization.id, tx);
        return revocation;
      });
    } catch (error) {
      if (error instanceof OrganizationOwnerRetentionError) {
        throw badRequest(error.message);
      }
      throw error;
    }

    await publishOrganizationExitChatRevocation(member.userId, chatRevocation);

    return c.body(null, 204);
  });
}
