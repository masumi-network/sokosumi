import { createRoute, z } from "@hono/zod-openapi";

import { notFound } from "@/helpers/error";
import { jsonErrorResponse, jsonSuccessResponse } from "@/helpers/openapi";
import { ok } from "@/helpers/response";
import { buildCreditsPayload } from "@/helpers/subscription";
import prisma from "@/lib/db/prisma";
import {
  type OpenAPIHonoWithAuth,
  withGlobalHeaderParameters,
} from "@/lib/hono";
import {
  resolveUsersPathUserId,
  usersRoutePathUserIdSchema,
} from "@/routes/v1/users/user-path-access";
import { creditsResponseSchema } from "@/schemas/user.schema";

const params = z.object({
  id: usersRoutePathUserIdSchema,
});

const route = withGlobalHeaderParameters(
  createRoute({
    method: "get",
    path: "/credits",
    description:
      "Get credit balance for the authenticated organization context (session active org, optional `X-Organization-Slug` when no active org, or coworker delegation headers): path `me` for the session user, or a user id when the effective user matches, a delegated coworker acts for that user, or a session admin requests any user. For a specific organization by id without relying on session context, use `GET /{id}/organizations/{organizationId}/credits`.",
    tags: ["Users"],
    request: {
      params,
    },
    responses: {
      200: jsonSuccessResponse(
        creditsResponseSchema,
        "Retrieve the user's credits for personal or organization context",
        {
          data: {
            credits: {
              subscription: {
                plan: "starter",
                status: "active",
                periodStart: "2025-01-01T00:00:00.000Z",
                periodEnd: "2025-02-01T00:00:00.000Z",
                cancelAtPeriodEnd: false,
                credits: {
                  total: 100,
                  remaining: 57.5,
                  used: 42.5,
                },
              },
              buffer: 12.5,
              total: 70,
            },
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
      500: jsonErrorResponse("Internal Server Error"),
    },
  }),
);

export default function mount(app: OpenAPIHonoWithAuth) {
  app.openapi(route, async (c) => {
    const { id: pathUser } = c.req.valid("param");

    const { targetUserId, userContext } = resolveUsersPathUserId(
      c.var.authContext,
      pathUser,
    );

    const user = await prisma.user.findUnique({
      where: { id: targetUserId },
      select: { id: true },
    });

    if (!user) {
      throw notFound("User not found");
    }

    const credits = await prisma.$transaction(async (tx) => {
      const organizationId =
        userContext.userId === targetUserId ? userContext.organizationId : null;
      const referenceId = organizationId ?? targetUserId;

      return await buildCreditsPayload({
        userId: targetUserId,
        organizationId,
        referenceId,
        tx,
      });
    });

    return ok(c, creditsResponseSchema.parse({ credits }));
  });
}
