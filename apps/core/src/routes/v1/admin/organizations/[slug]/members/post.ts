import { createRoute } from "@hono/zod-openapi";
import { MemberRole } from "@sokosumi/database";
import {
  memberRepository,
  userRepository,
} from "@sokosumi/database/repositories";

import {
  getAdminOrganizationBySlug,
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

    const organization = await getAdminOrganizationBySlug(slug, prisma);
    if (!organization) {
      throw notFound("Organization not found");
    }

    const user = await userRepository.getUserById(body.userId, prisma);
    if (!user) {
      throw notFound("User not found");
    }

    const existingMember =
      await memberRepository.getMemberByUserIdAndOrganizationId(
        body.userId,
        organization.id,
        prisma,
      );
    if (existingMember) {
      throw conflict("User is already a member of this organization");
    }

    const role = body.role as MemberRole;

    const member = await prisma.$transaction(async (tx) => {
      await ensurePersonalWorkspaceForOrganizationMembership(body.userId, {
        tx,
        organizationId: organization.id,
      });
      const created = await memberRepository.createMember(
        body.userId,
        organization.id,
        role,
        tx,
      );
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
