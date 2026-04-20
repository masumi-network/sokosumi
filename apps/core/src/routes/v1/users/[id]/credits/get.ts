import { createRoute, z } from "@hono/zod-openapi";

import { badRequest, notFound } from "@/helpers/error";
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

const query = z.object({
  organizationId: z
    .string()
    .optional()
    .openapi({
      param: { name: "organizationId", in: "query" },
      description:
        "When set, returns credits for this user in the given organization context (the user must be a member). When omitted, returns credits for the active organization from request headers when the caller is that user (or their delegated coworker), or personal credits when an admin requests another user's balance without an organization.",
      example: "org_123",
    }),
});

const route = withGlobalHeaderParameters(
  createRoute({
    method: "get",
    path: "/{id}/credits",
    description:
      "Get credit balance: path `me` for the session user (same as organization headers on `/me`), or a user id when the effective user matches, a delegated coworker acts for that user, or a session admin requests any user.",
    tags: ["Users"],
    request: {
      params,
      query,
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
      400: jsonErrorResponse("Bad Request"),
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
    const { organizationId: queryOrganizationId } = c.req.valid("query");

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
      if (queryOrganizationId) {
        const member = await tx.member.findUnique({
          where: {
            userId_organizationId: {
              userId: targetUserId,
              organizationId: queryOrganizationId,
            },
          },
          select: { userId: true },
        });

        if (!member) {
          throw badRequest(
            "User is not a member of the specified organization",
          );
        }

        return await buildCreditsPayload({
          userId: targetUserId,
          organizationId: queryOrganizationId,
          referenceId: queryOrganizationId,
          tx,
        });
      }

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
