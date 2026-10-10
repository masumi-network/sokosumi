import { createRoute } from "@hono/zod-openapi";
import { waitUntil } from "@vercel/functions";
import { z } from "zod";

import { jsonErrorResponse, jsonSuccessResponse } from "@/helpers/openapi";
import { ok } from "@/helpers/response";
import prisma from "@/lib/db/prisma";
import {
  type OpenAPIHonoWithAuth,
  withOrganizationSlugHeaderParameter,
} from "@/lib/hono";
import { requireInteractiveUserAuthContext } from "@/middleware/auth";
import { requireWorkspaceContext } from "@/middleware/workspace";
import { projectSocialConnectionParamsSchema } from "@/schemas/project-social-connection.schema";
import { enqueueSocialAccountSync } from "@/services/social-performance-enqueue.service";

const route = withOrganizationSlugHeaderParameter(
  createRoute({
    method: "post",
    path: "/{id}/social-connections/{connectionId}/statistics/refresh",
    request: {
      params: projectSocialConnectionParamsSchema,
    },
    responses: {
      200: jsonSuccessResponse(
        z.object({ success: z.literal(true) }),
        "Statistics refresh enqueued",
      ),
      404: jsonErrorResponse("Connection not found"),
    },
  }),
);

export default function mountRefreshSocialAccountStatistics(
  app: OpenAPIHonoWithAuth,
) {
  app.openapi(route, async (c) => {
    const _userContext = requireInteractiveUserAuthContext(c.var.authContext);
    const workspaceContext = requireWorkspaceContext(c.var.workspaceContext);
    const { id: projectId, connectionId } = c.req.valid("param");

    const connection = await prisma.projectSocialConnection.findFirst({
      where: {
        id: connectionId,
        projectId,
        project: { workspaceId: workspaceContext.workspaceId },
      },
      select: { id: true, workspaceId: true },
    });

    if (!connection) {
      return c.json({ error: "Connection not found" }, 404);
    }

    // Enqueue background sync (non-blocking, deduped by lock service)
    if (process.env.VERCEL) {
      waitUntil(
        enqueueSocialAccountSync({
          projectId,
          workspaceId: connection.workspaceId,
          connectionId,
          reason: "manual",
        }),
      );
    }

    return ok(c, { success: true as const });
  });
}
