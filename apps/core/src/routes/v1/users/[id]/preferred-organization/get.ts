import { createRoute, z } from "@hono/zod-openapi";
import {
  memberRepository,
  userRepository,
} from "@sokosumi/database/repositories";

import { jsonErrorResponse, jsonSuccessResponse } from "@/helpers/openapi";
import { ok } from "@/helpers/response";
import prisma from "@/lib/db/prisma";
import type { OpenAPIHonoWithAuth } from "@/lib/hono";
import { usersRoutePathUserIdSchema } from "@/routes/v1/users/user-path-access";
import {
  requireUserRouteContext,
  type UserRouteVariables,
} from "@/routes/v1/users/user-route-context";
import { preferredOrganizationResponseSchema } from "@/schemas/user.schema";

const params = z.object({
  id: usersRoutePathUserIdSchema,
});

const route = createRoute({
  method: "get",
  path: "/preferred-organization",
  description: "Get the user's preferred organization id when still a member.",
  tags: ["Users"],
  request: { params },
  responses: {
    200: jsonSuccessResponse(
      preferredOrganizationResponseSchema,
      "Retrieve preferred organization id",
      {
        data: {
          organizationId: "org_123",
        },
        meta: {
          timestamp: "2025-01-01T00:00:00.000Z",
          requestId: "550e8400-e29b-41d4-a716-446655440000",
        },
      },
    ),
    401: jsonErrorResponse("Unauthorized"),
    403: jsonErrorResponse("Forbidden"),
    404: jsonErrorResponse("Not Found"),
  },
});

export default function mount(app: OpenAPIHonoWithAuth<UserRouteVariables>) {
  app.openapi(route, async (c) => {
    c.req.valid("param");
    const { resolvedUserId } = requireUserRouteContext(c.var.userRouteContext);

    const organizationId = await prisma.$transaction(async (tx) => {
      const user = await userRepository.getUserById(resolvedUserId, tx);
      const preferredOrganizationId = user?.preferredOrganizationId ?? null;

      if (!preferredOrganizationId) {
        return null;
      }

      const member = await memberRepository.getMemberByUserIdAndOrganizationId(
        resolvedUserId,
        preferredOrganizationId,
        tx,
      );

      return member ? preferredOrganizationId : null;
    });

    return ok(c, preferredOrganizationResponseSchema.parse({ organizationId }));
  });
}
