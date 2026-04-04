import { createRoute, z } from "@hono/zod-openapi";

import { jsonErrorResponse, jsonSuccessResponse } from "@/helpers/openapi";
import { ok } from "@/helpers/response";
import prisma from "@/lib/db/prisma";
import type { OpenAPIHonoWithAuth } from "@/lib/hono";
import { requireUserAuthContext } from "@/middleware/auth";

const statusSchema = z.object({
  connected: z.boolean(),
  email: z.string().nullable().optional(),
});

const route = createRoute({
  method: "get",
  path: "/google-drive/status",
  description: "Check Google Drive connection status",
  tags: ["Google Drive"],
  responses: {
    200: jsonSuccessResponse(statusSchema, "Google Drive connection status"),
    401: jsonErrorResponse("Unauthorized"),
    403: jsonErrorResponse("Forbidden"),
    500: jsonErrorResponse("Internal Server Error"),
  },
});

export default function mount(app: OpenAPIHonoWithAuth) {
  app.openapi(route, async (c) => {
    const authContext = requireUserAuthContext(c.var.authContext);

    const connection = await prisma.googleDriveConnection.findUnique({
      where: { userId: authContext.userId },
      select: { email: true },
    });

    return ok(c, {
      connected: !!connection,
      email: connection?.email ?? null,
    });
  });
}
