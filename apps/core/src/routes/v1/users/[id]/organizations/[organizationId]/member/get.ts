import { createRoute, z } from "@hono/zod-openapi";
import { memberRepository } from "@sokosumi/database/repositories";

import { notFound } from "@/helpers/error";
import { jsonErrorResponse, jsonSuccessResponse } from "@/helpers/openapi";
import { ok } from "@/helpers/response";
import prisma from "@/lib/db/prisma";
import type { OpenAPIHonoWithAuth } from "@/lib/hono";
import { usersRoutePathUserIdSchema } from "@/routes/v1/users/user-path-access";
import {
  requireUserRouteContext,
  type UserRouteVariables,
} from "@/routes/v1/users/user-route-context";
import { memberRecordSchema } from "@/schemas/member.schema";

const params = z.object({
  id: usersRoutePathUserIdSchema,
  organizationId: z.string().openapi({
    param: { name: "organizationId", in: "path" },
    description: "Organization ID",
    example: "org_123",
  }),
});

const route = createRoute({
  method: "get",
  path: "/organizations/{organizationId}/member",
  description:
    "Get the user's own membership record in an organization: first path segment is `me` or a user id; second is the organization id. Responds 404 when the user is not a member.",
  tags: ["Users"],
  request: {
    params,
  },
  responses: {
    200: jsonSuccessResponse(
      memberRecordSchema,
      "Retrieve the user's membership in the organization",
      {
        data: {
          id: "member_123",
          userId: "user_123",
          organizationId: "org_123",
          role: "member",
          seatAssignedAt: null,
          createdAt: "2025-01-01T00:00:00.000Z",
        },
        meta: {
          timestamp: "2025-01-01T00:00:00.000Z",
          requestId: "550e8400-e29b-41d4-a716-446655440000",
        },
      },
    ),
    401: jsonErrorResponse("Unauthorized"),
    403: jsonErrorResponse("Forbidden"),
    404: jsonErrorResponse("Not Found - The user is not a member"),
    500: jsonErrorResponse("Internal Server Error"),
  },
});

export default function mount(app: OpenAPIHonoWithAuth<UserRouteVariables>) {
  app.openapi(route, async (c) => {
    const { organizationId } = c.req.valid("param");
    const { resolvedUserId } = requireUserRouteContext(c.var.userRouteContext);

    const member = await memberRepository.getMemberByUserIdAndOrganizationId(
      resolvedUserId,
      organizationId,
      prisma,
    );

    if (!member) {
      throw notFound("Membership not found");
    }

    return ok(c, memberRecordSchema.parse(member));
  });
}
