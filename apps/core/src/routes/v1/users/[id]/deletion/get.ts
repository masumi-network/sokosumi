import { createRoute, z } from "@hono/zod-openapi";

import { evaluateUserDeletion } from "@/helpers/deletion-evaluate";
import { forbidden } from "@/helpers/error";
import { jsonErrorResponse, jsonSuccessResponse } from "@/helpers/openapi";
import { ok } from "@/helpers/response";
import prisma from "@/lib/db/prisma";
import type { OpenAPIHonoWithAuth } from "@/lib/hono";
import { requireUserAuthContext } from "@/middleware/auth";
import { usersRoutePathUserIdSchema } from "@/routes/v1/users/user-path-access";
import {
  requireUserRouteContext,
  type UserRouteVariables,
} from "@/routes/v1/users/user-route-context";
import { userDeletionEvaluationSchema } from "@/schemas/deletion.schema";

const params = z.object({
  id: usersRoutePathUserIdSchema,
});

const route = createRoute({
  method: "get",
  path: "/deletion",
  description:
    "Return current User-deletion blockers for the signed-in user (path `me` or their own user id). Empty `blockers` means the existing wipe may proceed. Coworkers, Soko Bots, and other users (including platform admins) cannot call this.",
  tags: ["Users"],
  request: {
    params,
  },
  responses: {
    200: jsonSuccessResponse(
      userDeletionEvaluationSchema,
      "Current User-deletion blockers",
      {
        data: {
          blockers: ["TASK_PAYMENT_CLAIM_PENDING"],
        },
        meta: {
          timestamp: "2025-01-01T00:00:00.000Z",
          requestId: "550e8400-e29b-41d4-a716-446655440000",
        },
      },
    ),
    401: jsonErrorResponse("Unauthorized"),
    403: jsonErrorResponse(
      "Forbidden - You can only evaluate your own deletion",
    ),
    404: jsonErrorResponse("Not Found - User not found"),
    500: jsonErrorResponse("Internal Server Error"),
  },
});

export default function mount(app: OpenAPIHonoWithAuth<UserRouteVariables>) {
  app.openapi(route, async (c) => {
    c.req.valid("param");
    const session = requireUserAuthContext(c.var.authContext);
    const { resolvedUserId } = requireUserRouteContext(c.var.userRouteContext);

    if (session.userId !== resolvedUserId) {
      throw forbidden("You can only evaluate your own account deletion");
    }

    const evaluation = await evaluateUserDeletion(resolvedUserId, prisma);
    return ok(
      c,
      userDeletionEvaluationSchema.parse({ blockers: evaluation.blockers }),
    );
  });
}
