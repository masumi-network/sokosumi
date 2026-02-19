import { createRoute } from "@hono/zod-openapi";

import { forbidden, internalServerError } from "@/helpers/error";
import { jsonErrorResponse, jsonSuccessResponse } from "@/helpers/openapi";
import { ok } from "@/helpers/response";
import prisma from "@/lib/db/prisma";
import type { OpenAPIHonoWithAuth } from "@/lib/hono";
import { pendingNoticesResponseSchema } from "@/schemas/notice.schema";

const route = createRoute({
  method: "get",
  path: "/notices/pending",
  description: "Get pending notices for the current user",
  tags: ["Users"],
  responses: {
    200: jsonSuccessResponse(
      pendingNoticesResponseSchema,
      "Retrieve pending notices for the current user",
      {
        data: {
          pendingNotices: [
            {
              id: "notice_123",
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
    500: jsonErrorResponse("Internal Server Error"),
  },
});

export default function mount(app: OpenAPIHonoWithAuth) {
  app.openapi(route, async (c) => {
    const { authContext } = c.var;

    if (authContext.coworkerId) {
      throw forbidden("Coworkers are not allowed to access notices");
    }

    const now = new Date();
    const pendingNotices = await prisma.$transaction(async (tx) => {
      const user = await tx.user.findUnique({
        where: { id: authContext.userId },
        select: { id: true, createdAt: true },
      });
      if (!user) {
        throw internalServerError("Failed to retrieve user");
      }

      return await tx.notice.findMany({
        where: {
          isActive: true,
          effectiveAt: {
            lte: now, // Only show notices that are active and effective at the current time
            gt: user.createdAt, // Only show notices that are effective after the user was created
          },
          acknowledgments: {
            none: {
              // Only show notices that have not been acknowledged
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
    });

    return ok(
      c,
      pendingNoticesResponseSchema.parse({
        pendingNotices,
      }),
    );
  });
}
