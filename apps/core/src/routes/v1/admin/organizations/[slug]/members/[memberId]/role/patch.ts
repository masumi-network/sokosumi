import { createRoute } from "@hono/zod-openapi";
import { MemberRole } from "@sokosumi/database";
import { OrganizationOwnerRetentionError } from "@sokosumi/database/helpers";
import { memberRepository } from "@sokosumi/database/repositories";

import {
  getAdminOrganizationBySlug,
  mapAdminOrganizationMemberOverviewItem,
  resolveAdminOrganizationOverviewSubscription,
} from "@/helpers/admin-organization-overview.js";
import { badRequest, notFound } from "@/helpers/error";
import { jsonErrorResponse, jsonSuccessResponse } from "@/helpers/openapi";
import { ok } from "@/helpers/response";
import prisma from "@/lib/db/prisma";
import type { OpenAPIHonoWithAuth } from "@/lib/hono";
import {
  adminOrganizationMemberIdParamSchema,
  adminOrganizationMemberOverviewItemSchema,
  adminUpdateOrganizationMemberRoleBodySchema,
} from "@/schemas/admin.schema";

const route = createRoute({
  method: "patch",
  path: "/{slug}/members/{memberId}/role",
  operationId: "updateAdminOrganizationMemberRole",
  description: "Update a member role within an organization (admin only).",
  tags: ["Admin"],
  request: {
    params: adminOrganizationMemberIdParamSchema,
    body: {
      content: {
        "application/json": {
          schema: adminUpdateOrganizationMemberRoleBodySchema,
        },
      },
    },
  },
  responses: {
    200: jsonSuccessResponse(
      adminOrganizationMemberOverviewItemSchema,
      "The updated organization member",
    ),
    400: jsonErrorResponse("Bad Request"),
    401: jsonErrorResponse("Unauthorized"),
    403: jsonErrorResponse("Forbidden"),
    404: jsonErrorResponse("Not Found"),
  },
});

export default function mount(app: OpenAPIHonoWithAuth) {
  app.openapi(route, async (c) => {
    const { slug, memberId } = c.req.valid("param");
    const body = c.req.valid("json");

    const organization = await getAdminOrganizationBySlug(slug, prisma);
    if (!organization) {
      throw notFound("Organization not found");
    }

    const existingMember =
      await memberRepository.getMemberByIdAndOrganizationId(
        memberId,
        organization.id,
        prisma,
      );
    if (!existingMember) {
      throw notFound("Member not found");
    }

    const role = body.role as MemberRole;

    try {
      await prisma.$transaction(async (tx) => {
        await memberRepository.updateMemberRole(
          memberId,
          organization.id,
          role,
          tx,
        );
      });
    } catch (error) {
      if (error instanceof OrganizationOwnerRetentionError) {
        throw badRequest(error.message);
      }
      throw error;
    }

    const members = await memberRepository.getMembersWithUserAndLastSeen(
      organization.id,
      prisma,
    );
    const updatedMember = members.find((item) => item.id === memberId);
    if (!updatedMember) {
      throw notFound("Member not found");
    }

    const subscription = await resolveAdminOrganizationOverviewSubscription(
      organization.id,
      prisma,
    );

    return ok(
      c,
      adminOrganizationMemberOverviewItemSchema.parse(
        mapAdminOrganizationMemberOverviewItem(updatedMember, subscription),
      ),
    );
  });
}
