import { createRoute } from "@hono/zod-openapi";
import { jsonErrorResponse, jsonSuccessResponse } from "@/helpers/openapi";
import { ok } from "@/helpers/response";
import prisma from "@/lib/db/prisma";
import type { OpenAPIHonoWithAuth } from "@/lib/hono";
import { requireOwnerUserContext } from "@/middleware/auth";
import { requireWorkspaceContext } from "@/middleware/workspace";
import { taskViewPreferenceSchema } from "./schema";

const route = createRoute({
  method: "get",
  path: "/view",
  description:
    "The Tasks page view the caller last chose in the active workspace, so the page can open it again. People only: Coworker and agent callers get 403.",
  tags: ["Tasks"],
  responses: {
    200: jsonSuccessResponse(
      taskViewPreferenceSchema,
      "The saved Tasks page view",
      {
        data: { query: "status=READY&sort=priority" },
        meta: {
          timestamp: "2026-11-19T12:00:00.000Z",
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
    const { userId } = requireOwnerUserContext(c.var.authContext);
    const { workspaceId } = requireWorkspaceContext(c.var.workspaceContext);

    const preference = await prisma.taskViewPreference.findUnique({
      where: { userId_workspaceId: { userId, workspaceId } },
      select: { query: true },
    });

    return ok(c, { query: preference?.query ?? null });
  });
}
