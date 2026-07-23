import { createRoute, z } from "@hono/zod-openapi";

import { jsonErrorResponse, jsonSuccessResponse } from "@/helpers/openapi";
import { ok } from "@/helpers/response";
import prisma from "@/lib/db/prisma";
import {
  type OpenAPIHonoWithAuth,
  withGlobalHeaderParameters,
} from "@/lib/hono";
import { requireUserAuthContext } from "@/middleware/auth";

const responseSchema = z
  .object({
    count: z.number().int().min(0).openapi({
      description: "Number of notifications marked as read",
      example: 10,
    }),
  })
  .openapi("MarkAllReadResponse");

const route = withGlobalHeaderParameters(
  createRoute({
    method: "patch",
    path: "/read-all",
    description: "Mark all notifications as read for the authenticated user",
    tags: ["Notifications"],
    responses: {
      200: jsonSuccessResponse(
        responseSchema,
        "All notifications marked as read",
        {
          data: { count: 10 },
          meta: {
            timestamp: "2026-06-16T15:00:00.000Z",
            requestId: "550e8400-e29b-41d4-a716-446655440000",
          },
        },
      ),
      401: jsonErrorResponse("Unauthorized"),
      500: jsonErrorResponse("Internal Server Error"),
    },
  }),
);

export default function mount(app: OpenAPIHonoWithAuth) {
  app.openapi(route, async (c) => {
    const userContext = requireUserAuthContext(c.var.authContext);

    const result = await prisma.notification.updateMany({
      where: {
        userId: userContext.userId,
        isRead: false,
      },
      data: {
        isRead: true,
        readAt: new Date(),
      },
    });

    return ok(c, responseSchema.parse({ count: result.count }));
  });
}
