import { createRoute } from "@hono/zod-openapi";
import { MemberRole } from "@sokosumi/database";
import { memberRepository } from "@sokosumi/database/repositories";

import {
  mapAdminOrganizationMemberOverviewItem,
  resolveAdminOrganizationOverviewSubscription,
} from "@/helpers/admin-organization-overview.js";
import { upgradeGuestChatRoomMembershipsToMember } from "@/helpers/chat-room-guest-upgrade";
import { conflict, notFound } from "@/helpers/error";
import { jsonErrorResponse, jsonSuccessResponse } from "@/helpers/openapi";
import { ensurePersonalWorkspaceForOrganizationMembership } from "@/helpers/org-membership-personal-workspace";
import { created } from "@/helpers/response";
import prisma from "@/lib/db/prisma";
import type { OpenAPIHonoWithAuth } from "@/lib/hono";
import {
  adminAddOrganizationMemberBodySchema,
  adminOrganizationMemberOverviewItemSchema,
  adminOrganizationSlugParamSchema,
} from "@/schemas/admin.schema";

const route = createRoute({
  method: "post",
  path: "/{slug}/members",
  operationId: "addAdminOrganizationMember",
  description:
    "Add an existing user as a member of an organization (admin only).",
  tags: ["Admin"],
  request: {
    params: adminOrganizationSlugParamSchema,
    body: {
      content: {
        "application/json": {
          schema: adminAddOrganizationMemberBodySchema,
        },
      },
    },
  },
  responses: {
    201: jsonSuccessResponse(
      adminOrganizationMemberOverviewItemSchema,
      "The newly added organization member",
    ),
    400: jsonErrorResponse("Bad Request"),
    401: jsonErrorResponse("Unauthorized"),
    403: jsonErrorResponse("Forbidden"),
    404: jsonErrorResponse("Not Found"),
    409: jsonErrorResponse("Conflict"),
  },
});

export default function mount(app: OpenAPIHonoWithAuth) {
  app.openapi(route, async (c) => {
    const { slug } = c.req.valid("param");
    const body = c.req.valid("json");

    const organization = await prisma.organization.findUnique({
      where: { slug },
      select: { id: true },
    });
    if (!organization) {
      throw notFound("Organization not found");
    }

    const user = await prisma.user.findUnique({
      where: { id: body.userId },
    });
    if (!user) {
      throw notFound("User not found");
    }

    const existingMember = await prisma.member.findUnique({
      where: {
        userId_organizationId: {
          userId: body.userId,
          organizationId: organization.id,
        },
      },
    });
    if (existingMember) {
      throw conflict("User is already a member of this organization");
    }

    const role = body.role as MemberRole;

    const member = await prisma.$transaction(async (tx) => {
      await ensurePersonalWorkspaceForOrganizationMembership(body.userId, {
        tx,
        organizationId: organization.id,
      });
      const created = await tx.member.create({
        data: {
          user: {
            connect: {
              id: body.userId,
            },
          },
          organization: {
            connect: {
              id: organization.id,
            },
          },
          role,
        },
      });
      await upgradeGuestChatRoomMembershipsToMember(
        body.userId,
        organization.id,
        tx,
      );
      return created;
    });

    const members = await memberRepository.getMembersWithUserAndLastSeen(
      organization.id,
      prisma,
    );
    const createdMember = members.find((item) => item.id === member.id);
    if (!createdMember) {
      throw notFound("Member not found");
    }

    const subscription = await resolveAdminOrganizationOverviewSubscription(
      organization.id,
      prisma,
    );

    return created(
      c,
      adminOrganizationMemberOverviewItemSchema.parse(
        mapAdminOrganizationMemberOverviewItem(createdMember, subscription),
      ),
    );
  });
}
