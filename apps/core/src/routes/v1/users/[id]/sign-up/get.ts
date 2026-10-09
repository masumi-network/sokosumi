import { createRoute, z } from "@hono/zod-openapi";

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
import { signUpContextSchema } from "@/schemas/user.schema";

const params = z.object({
  id: usersRoutePathUserIdSchema,
});

const route = createRoute({
  method: "get",
  path: "/sign-up",
  description:
    "Return the user's sign-up origin and sign-up context: path `me` for the authenticated user, or a user id for platform admins. Accounts created before sign-up recording have none (404).",
  tags: ["Users"],
  request: {
    params,
  },
  responses: {
    200: jsonSuccessResponse(signUpContextSchema, "The user's sign-up", {
      data: {
        origin: "cmo",
        context: { url: "nmkr.io" },
        createdAt: "2025-01-01T00:00:00.000Z",
      },
      meta: {
        timestamp: "2025-01-01T00:00:00.000Z",
        requestId: "550e8400-e29b-41d4-a716-446655440000",
      },
    }),
    401: jsonErrorResponse("Unauthorized"),
    403: jsonErrorResponse("Forbidden"),
    404: jsonErrorResponse("Not Found - User or sign-up not found"),
  },
});

export default function mount(app: OpenAPIHonoWithAuth<UserRouteVariables>) {
  app.openapi(route, async (c) => {
    c.req.valid("param");
    const { resolvedUserId } = requireUserRouteContext(c.var.userRouteContext);

    const signUp = await prisma.signUpContext.findUnique({
      where: { userId: resolvedUserId },
      select: { origin: true, entries: true, createdAt: true },
    });
    if (!signUp) {
      throw notFound("No sign-up recorded for this user");
    }

    return ok(
      c,
      signUpContextSchema.parse({
        origin: signUp.origin,
        context: signUp.entries,
        createdAt: signUp.createdAt,
      }),
    );
  });
}
