import { createRoute, z } from "@hono/zod-openapi";

import { badRequest, forbidden, notFound } from "@/helpers/error";
import { jsonErrorResponse, jsonSuccessResponse } from "@/helpers/openapi";
import { ok } from "@/helpers/response";
import { buildCreditsPayload } from "@/helpers/subscription";
import prisma from "@/lib/db/prisma";
import {
  type OpenAPIHonoWithAuth,
  withGlobalHeaderParameters,
} from "@/lib/hono";
import { hasAdminRole, isUserAuthContext } from "@/middleware/auth";
import { creditsResponseSchema } from "@/schemas/user.schema";

const params = z.object({
  id: z.string().openapi({
    param: { name: "id", in: "path" },
    description: "User ID whose credits are being retrieved",
    example: "usr_123",
  }),
});

const query = z.object({
  organizationId: z
    .string()
    .optional()
    .openapi({
      param: { name: "organizationId", in: "query" },
      description:
        "When set, returns credits for this user in the given organization context (the user must be a member). Omit for personal (non-organization) credits.",
      example: "org_123",
    }),
});

const route = withGlobalHeaderParameters(
  createRoute({
    method: "get",
    path: "/{id}/credits",
    description:
      "Get credit balance for a user by ID. Restricted to admin users or authenticated coworkers.",
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
    const { authContext } = c.var;
    const { id: targetUserId } = c.req.valid("param");
    const { organizationId } = c.req.valid("query");

    if (isUserAuthContext(authContext) && !hasAdminRole(authContext.role)) {
      forbidden("Admin access required");
    }

    const user = await prisma.user.findUnique({
      where: { id: targetUserId },
      select: { id: true },
    });

    if (!user) {
      notFound("User not found");
    }

    const credits = await prisma.$transaction(async (tx) => {
      if (organizationId) {
        const member = await tx.member.findUnique({
          where: {
            userId_organizationId: {
              userId: targetUserId,
              organizationId,
            },
          },
          select: { userId: true },
        });

        if (!member) {
          badRequest("User is not a member of the specified organization");
        }

        return await buildCreditsPayload({
          userId: targetUserId,
          organizationId,
          referenceId: organizationId,
          tx,
        });
      }

      return await buildCreditsPayload({
        userId: targetUserId,
        organizationId: null,
        referenceId: targetUserId,
        tx,
      });
    });

    return ok(c, creditsResponseSchema.parse({ credits }));
  });
}
