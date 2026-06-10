import { createRoute, z } from "@hono/zod-openapi";

import { jsonErrorResponse, jsonSuccessResponse } from "@/helpers/openapi";
import { ok } from "@/helpers/response";
import prisma from "@/lib/db/prisma";
import type { OpenAPIHonoWithAuth } from "@/lib/hono";
import { usersRoutePathUserIdSchema } from "@/routes/v1/users/user-path-access";
import {
  requireUserRouteContext,
  type UserRouteVariables,
} from "@/routes/v1/users/user-route-context";
import { oauthConsentsSchema } from "@/schemas/oauth.schema";

const params = z.object({
  id: usersRoutePathUserIdSchema,
});

const route = createRoute({
  method: "get",
  path: "/oauth/consents",
  description: "List OAuth consents granted by the session user.",
  tags: ["Users"],
  request: { params },
  responses: {
    200: jsonSuccessResponse(
      oauthConsentsSchema,
      "List OAuth consents for the current user",
      {
        data: [
          {
            id: "consent_123",
            clientId: "client_abc",
            scopes: ["openid", "profile"],
            createdAt: "2025-01-01T00:00:00.000Z",
          },
        ],
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

    const consents = await prisma.oauthConsent.findMany({
      where: { userId: resolvedUserId },
      orderBy: { createdAt: "desc" },
      select: {
        id: true,
        clientId: true,
        scopes: true,
        createdAt: true,
      },
    });

    return ok(c, oauthConsentsSchema.parse(consents));
  });
}
