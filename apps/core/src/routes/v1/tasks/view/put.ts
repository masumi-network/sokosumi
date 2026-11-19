import { createRoute } from "@hono/zod-openapi";
import { jsonErrorResponse, jsonSuccessResponse } from "@/helpers/openapi";
import { ok } from "@/helpers/response";
import prisma from "@/lib/db/prisma";
import type { OpenAPIHonoWithAuth } from "@/lib/hono";
import { requireOwnerUserContext } from "@/middleware/auth";
import { requireWorkspaceContext } from "@/middleware/workspace";
import {
  taskViewPreferenceSchema,
  taskViewPreferenceWriteSchema,
} from "./schema";

const route = createRoute({
  method: "put",
  path: "/view",
  description:
    "Save the Tasks page view the caller chose in the active workspace. The last write wins. Interactive session users only.",
  tags: ["Tasks"],
  request: {
    body: {
      content: {
        "application/json": { schema: taskViewPreferenceWriteSchema },
      },
    },
  },
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
    422: jsonErrorResponse("Unprocessable Entity"),
    401: jsonErrorResponse("Unauthorized"),
    403: jsonErrorResponse("Forbidden"),
    500: jsonErrorResponse("Internal Server Error"),
  },
});

export default function mount(app: OpenAPIHonoWithAuth) {
  app.openapi(route, async (c) => {
    const { userId } = requireOwnerUserContext(c.var.authContext);
    const { workspaceId } = requireWorkspaceContext(c.var.workspaceContext);
    const { query } = c.req.valid("json");

    await prisma.taskViewPreference.upsert({
      where: { userId_workspaceId: { userId, workspaceId } },
      create: { userId, workspaceId, query },
      update: { query },
    });

    return ok(c, { query });
  });
}
