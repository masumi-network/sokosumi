import { createRoute, z } from "@hono/zod-openapi";

import { jsonErrorResponse, jsonSuccessResponse } from "@/helpers/openapi";
import { ok } from "@/helpers/response";
import { buildCreditsPayload } from "@/helpers/subscription";
import prisma from "@/lib/db/prisma";
import {
  type OpenAPIHonoWithAuth,
  withCoworkerContextHeaderParameters,
} from "@/lib/hono";
import { usersRoutePathUserIdSchema } from "@/routes/v1/users/user-path-access";
import {
  requireUserRouteContext,
  type UserRouteVariables,
} from "@/routes/v1/users/user-route-context";
import { creditsResponseSchema } from "@/schemas/user.schema";

const params = z.object({
  id: usersRoutePathUserIdSchema,
});

const route = withCoworkerContextHeaderParameters(
  createRoute({
    method: "get",
    path: "/credits",
    description:
      "Get credit balance for the authenticated organization context (session active org, or optional `X-Organization-Slug` when no active org): path `me` for the session user, or a user id when the session user matches that id, a session admin requests any user, or orchestrator/coworker with matching `X-Context-User-Id`. For a specific organization by id without relying on session context, use `GET /{id}/organizations/{organizationId}/credits`.",
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
            extra: {
              credits: {
                total: 25,
                remaining: 12.5,
                used: 12.5,
              },
              buckets: [
                {
                  total: 25,
                  remaining: 12.5,
                  expiresAt: "2026-08-01T00:00:00.000Z",
                },
              ],
            },
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

export default function mount(app: OpenAPIHonoWithAuth<UserRouteVariables>) {
  app.openapi(route, async (c) => {
    c.req.valid("param");
    const { resolvedUserId, userContext } = requireUserRouteContext(
      c.var.userRouteContext,
    );

    const payload = await prisma.$transaction(async (tx) => {
      const organizationId =
        userContext.userId === resolvedUserId
          ? userContext.organizationId
          : null;
      const referenceId = organizationId ?? resolvedUserId;

      return await buildCreditsPayload({
        userId: resolvedUserId,
        organizationId,
        referenceId,
        tx,
      });
    });

    return ok(c, creditsResponseSchema.parse(payload));
  });
}
