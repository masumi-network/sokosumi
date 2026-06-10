import { createRoute, z } from "@hono/zod-openapi";
import {
  memberRepository,
  userRepository,
} from "@sokosumi/database/repositories";

import { badRequest } from "@/helpers/error";
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

const requestBodySchema = z.object({
  organizationId: z.string().nullable().openapi({
    description: "Preferred organization id, or null to clear",
    example: "org_123",
  }),
});

const route = createRoute({
  method: "patch",
  path: "/preferred-organization",
  description: "Update the user's preferred organization id.",
  tags: ["Users"],
  request: {
    params,
    body: {
      content: {
        "application/json": {
          schema: requestBodySchema,
        },
      },
    },
  },
  responses: {
    200: jsonSuccessResponse(
      preferredOrganizationResponseSchema,
      "Update preferred organization id",
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
    400: jsonErrorResponse("Bad Request"),
    401: jsonErrorResponse("Unauthorized"),
    403: jsonErrorResponse("Forbidden"),
    404: jsonErrorResponse("Not Found"),
  },
});

export default function mount(app: OpenAPIHonoWithAuth<UserRouteVariables>) {
  app.openapi(route, async (c) => {
    c.req.valid("param");
    const { resolvedUserId } = requireUserRouteContext(c.var.userRouteContext);
    const { organizationId } = c.req.valid("json");

    const result = await prisma.$transaction(async (tx) => {
      if (!organizationId) {
        await userRepository.updatePreferredOrganizationId(
          resolvedUserId,
          null,
          tx,
        );
        return { organizationId: null };
      }

      const member = await memberRepository.getMemberByUserIdAndOrganizationId(
        resolvedUserId,
        organizationId,
        tx,
      );

      if (!member) {
        throw badRequest("You are not a member of this organization");
      }

      await userRepository.updatePreferredOrganizationId(
        resolvedUserId,
        organizationId,
        tx,
      );

      return { organizationId };
    });

    return ok(c, preferredOrganizationResponseSchema.parse(result));
  });
}
