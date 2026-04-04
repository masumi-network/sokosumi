import { createRoute, z } from "@hono/zod-openapi";

import { notFound } from "@/helpers/error";
import { jsonErrorResponse, jsonSuccessResponse } from "@/helpers/openapi";
import { ok } from "@/helpers/response";
import prisma from "@/lib/db/prisma";
import type { OpenAPIHonoWithAuth } from "@/lib/hono";
import { requireUserAuthContext } from "@/middleware/auth";

const disconnectResponseSchema = z.object({
  disconnected: z.boolean(),
});

const route = createRoute({
  method: "delete",
  path: "/google-drive/disconnect",
  description: "Remove Google Drive connection",
  tags: ["Google Drive"],
  responses: {
    200: jsonSuccessResponse(
      disconnectResponseSchema,
      "Google Drive disconnected",
    ),
    401: jsonErrorResponse("Unauthorized"),
    403: jsonErrorResponse("Forbidden"),
    404: jsonErrorResponse("Not Found"),
    500: jsonErrorResponse("Internal Server Error"),
  },
});

export default function mount(app: OpenAPIHonoWithAuth) {
  app.openapi(route, async (c) => {
    const authContext = requireUserAuthContext(c.var.authContext);

    const existing = await prisma.googleDriveConnection.findUnique({
      where: { userId: authContext.userId },
    });

    if (!existing) {
      throw notFound("Google Drive is not connected");
    }

    await prisma.googleDriveConnection.delete({
      where: { userId: authContext.userId },
    });

    return ok(c, { disconnected: true });
  });
}
