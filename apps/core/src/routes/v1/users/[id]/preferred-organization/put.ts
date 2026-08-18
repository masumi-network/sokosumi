import { createRoute, z } from "@hono/zod-openapi";
import {
  memberRepository,
  userRepository,
} from "@sokosumi/database/repositories";
import { CORE_API_ERROR_KINDS } from "@sokosumi/utils";

import { forbidden, notFound } from "@/helpers/error";
import { jsonErrorResponse, jsonSuccessResponse } from "@/helpers/openapi";
import { ok } from "@/helpers/response";
import prisma from "@/lib/db/prisma";
import type { OpenAPIHonoWithAuth } from "@/lib/hono";
import { usersRoutePathUserIdSchema } from "@/routes/v1/users/user-path-access";
import {
  requireUserRouteContext,
  type UserRouteVariables,
} from "@/routes/v1/users/user-route-context";
import { preferredOrganizationSchema } from "@/schemas/preferred-organization.schema";

const params = z.object({
  id: usersRoutePathUserIdSchema,
});

const route = createRoute({
  method: "put",
  path: "/preferred-organization",
  description:
    "Set the user's preferred organization workspace (path `me` for the session user, or a user id the caller may access). Pass a null `organizationId` to switch to the personal workspace — refused when the personal workspace is missing. Setting an organization requires the user to be a member of it; the membership check and the write happen in one transaction.",
  tags: ["Users"],
  request: {
    params,
    body: {
      content: {
        "application/json": {
          schema: preferredOrganizationSchema,
        },
      },
    },
  },
  responses: {
    200: jsonSuccessResponse(
      preferredOrganizationSchema,
      "The persisted preferred organization",
      {
        data: { organizationId: "org_123" },
        meta: {
          timestamp: "2025-01-01T00:00:00.000Z",
          requestId: "550e8400-e29b-41d4-a716-446655440000",
        },
      },
    ),
    400: jsonErrorResponse("Bad Request"),
    401: jsonErrorResponse("Unauthorized"),
    403: jsonErrorResponse(
      "Forbidden - The user is not a member of the organization",
    ),
    404: jsonErrorResponse(
      "Not Found - User not found, or personal workspace is missing",
    ),
    500: jsonErrorResponse("Internal Server Error"),
  },
});

export default function mount(app: OpenAPIHonoWithAuth<UserRouteVariables>) {
  app.openapi(route, async (c) => {
    c.req.valid("param");
    const { resolvedUserId } = requireUserRouteContext(c.var.userRouteContext);
    const { organizationId } = c.req.valid("json");

    if (!organizationId) {
      const personalWorkspace = await prisma.workspace.findUnique({
        where: { userId: resolvedUserId },
        select: { id: true },
      });
      if (!personalWorkspace) {
        throw notFound("Personal workspace is missing", {
          kind: CORE_API_ERROR_KINDS.PERSONAL_WORKSPACE_MISSING,
        });
      }
      await userRepository.updatePreferredOrganizationId(
        resolvedUserId,
        null,
        prisma,
      );
      return ok(c, preferredOrganizationSchema.parse({ organizationId: null }));
    }

    await prisma.$transaction(async (tx) => {
      const member = await memberRepository.getMemberByUserIdAndOrganizationId(
        resolvedUserId,
        organizationId,
        tx,
      );

      if (!member) {
        throw forbidden("The user is not a member of the organization", {
          kind: CORE_API_ERROR_KINDS.ORGANIZATION_MEMBERSHIP_REQUIRED,
        });
      }

      await userRepository.updatePreferredOrganizationId(
        resolvedUserId,
        organizationId,
        tx,
      );
    });

    return ok(c, preferredOrganizationSchema.parse({ organizationId }));
  });
}
