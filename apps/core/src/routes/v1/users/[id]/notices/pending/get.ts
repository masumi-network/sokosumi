import { createRoute, z } from "@hono/zod-openapi";

import { internalServerError } from "@/helpers/error";
import { jsonErrorResponse, jsonSuccessResponse } from "@/helpers/openapi";
import { ok } from "@/helpers/response";
import prisma from "@/lib/db/prisma";
import type { OpenAPIHonoWithAuth } from "@/lib/hono";
import { usersRoutePathUserIdSchema } from "@/routes/v1/users/user-path-access";
import {
  requireUserRouteContext,
  type UserRouteVariables,
} from "@/routes/v1/users/user-route-context";
import { pendingNoticesResponseSchema } from "@/schemas/notice.schema";

const params = z.object({
  id: usersRoutePathUserIdSchema,
});

const route = createRoute({
  method: "get",
  path: "/notices/pending",
  description:
    "Get pending notices: path `me` for the session user, or a user id when the caller may access that user's data.",
  tags: ["Users"],
  request: { params },
  responses: {
    200: jsonSuccessResponse(
      pendingNoticesResponseSchema,
      "Retrieve pending notices for the user",
      {
        data: {
          pendingNotices: [
            {
              id: "notice_123",
              kind: "LEGAL_TERMS",
              bodyMarkdown: "## Terms update\nPlease review the latest terms.",
              effectiveAt: "2026-02-20T09:00:00.000Z",
              isActive: true,
              createdAt: "2026-02-19T10:00:00.000Z",
              updatedAt: "2026-02-19T10:00:00.000Z",
            },
          ],
        },
        meta: {
          timestamp: "2026-02-20T09:00:00.000Z",
          requestId: "550e8400-e29b-41d4-a716-446655440000",
        },
      },
    ),
    401: jsonErrorResponse("Unauthorized"),
    403: jsonErrorResponse("Forbidden"),
    404: jsonErrorResponse("Not Found"),
    500: jsonErrorResponse("Internal Server Error"),
  },
});

export default function mount(app: OpenAPIHonoWithAuth<UserRouteVariables>) {
  app.openapi(route, async (c) => {
    c.req.valid("param");
    const { resolvedUserId } = requireUserRouteContext(c.var.userRouteContext);

    const now = new Date();
    const user = await prisma.user.findUnique({
      where: { id: resolvedUserId },
      select: { id: true, createdAt: true },
    });
    if (!user) {
      throw internalServerError("Failed to retrieve user");
    }

    const pendingNotices = await prisma.notice.findMany({
      where: {
        isActive: true,
        effectiveAt: {
          lte: now,
          gt: user.createdAt,
        },
        acknowledgments: {
          none: {
            userId: user.id,
          },
        },
      },
      orderBy: [
        {
          effectiveAt: "asc",
        },
        {
          createdAt: "asc",
        },
      ],
    });

    return ok(
      c,
      pendingNoticesResponseSchema.parse({
        pendingNotices,
      }),
    );
  });
}
