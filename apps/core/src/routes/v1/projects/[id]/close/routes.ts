import { createRoute, z } from "@hono/zod-openapi";

import { deliverCalendarInvalidationsNow } from "@/helpers/calendar-invalidation";
import { jsonErrorResponse, jsonSuccessResponse } from "@/helpers/openapi";
import { ok } from "@/helpers/response";
import type { OpenAPIHonoWithAuth } from "@/lib/hono";
import { requireOwnerUserContext } from "@/middleware/auth";
import { requireWorkspaceContext } from "@/middleware/workspace";
import {
  projectCloseRecoveryRequestSchema,
  projectCloseRequestSchema,
  projectCloseStatusSchema,
} from "@/schemas/project-close.schema";
import {
  cancelProjectCloseOwedWork,
  getProjectCloseStatus,
  requestProjectClose,
  retryProjectClose,
} from "@/services/project-close-lifecycle.service";

const paramsSchema = z.object({
  id: z.uuid().openapi({ param: { name: "id", in: "path" } }),
});

const commonResponses = {
  200: jsonSuccessResponse(projectCloseStatusSchema, "Project close status"),
  401: jsonErrorResponse("Unauthorized"),
  403: jsonErrorResponse("Forbidden"),
  404: jsonErrorResponse("Not Found"),
  409: jsonErrorResponse("Conflict"),
  422: jsonErrorResponse("Unprocessable Entity"),
};

const getRoute = createRoute({
  method: "get",
  path: "/{id}/close",
  tags: ["Projects"],
  description: "Read the durable close status for a Project.",
  request: { params: paramsSchema },
  responses: commonResponses,
});

const closeRoute = createRoute({
  method: "post",
  path: "/{id}/close",
  tags: ["Projects"],
  description:
    "Freeze a revision-protected cutoff and begin closing a Project. Interactive session user only.",
  request: {
    params: paramsSchema,
    body: {
      content: { "application/json": { schema: projectCloseRequestSchema } },
    },
  },
  responses: commonResponses,
});

const retryRoute = createRoute({
  method: "post",
  path: "/{id}/close/retry",
  tags: ["Projects"],
  description: "Retry a failed Project close with a new idempotency key.",
  request: {
    params: paramsSchema,
    body: {
      content: {
        "application/json": { schema: projectCloseRecoveryRequestSchema },
      },
    },
  },
  responses: commonResponses,
});

const cancelOwedRoute = createRoute({
  method: "post",
  path: "/{id}/close/cancel-owed",
  tags: ["Projects"],
  description:
    "Explicitly cancel the owed work in a failed series and resume closing.",
  request: {
    params: paramsSchema,
    body: {
      content: {
        "application/json": { schema: projectCloseRecoveryRequestSchema },
      },
    },
  },
  responses: commonResponses,
});

export default function mount(app: OpenAPIHonoWithAuth) {
  app.openapi(getRoute, async (c) => {
    requireOwnerUserContext(c.var.authContext);
    const workspace = requireWorkspaceContext(c.var.workspaceContext);
    const { id } = c.req.valid("param");
    return ok(
      c,
      projectCloseStatusSchema.parse(
        await getProjectCloseStatus({
          projectId: id,
          workspaceId: workspace.workspaceId,
        }),
      ),
    );
  });

  app.openapi(closeRoute, async (c) => {
    const user = requireOwnerUserContext(c.var.authContext);
    const workspace = requireWorkspaceContext(c.var.workspaceContext);
    const { id } = c.req.valid("param");
    const status = await requestProjectClose(
      {
        projectId: id,
        workspaceId: workspace.workspaceId,
        actorUserId: user.userId,
      },
      c.req.valid("json"),
    );
    await deliverCalendarInvalidationsNow(workspace.workspaceId);
    return ok(c, projectCloseStatusSchema.parse(status));
  });

  app.openapi(retryRoute, async (c) => {
    const user = requireOwnerUserContext(c.var.authContext);
    const workspace = requireWorkspaceContext(c.var.workspaceContext);
    const { id } = c.req.valid("param");
    const status = await retryProjectClose(
      {
        projectId: id,
        workspaceId: workspace.workspaceId,
        actorUserId: user.userId,
      },
      c.req.valid("json"),
    );
    await deliverCalendarInvalidationsNow(workspace.workspaceId);
    return ok(c, projectCloseStatusSchema.parse(status));
  });

  app.openapi(cancelOwedRoute, async (c) => {
    const user = requireOwnerUserContext(c.var.authContext);
    const workspace = requireWorkspaceContext(c.var.workspaceContext);
    const { id } = c.req.valid("param");
    const status = await cancelProjectCloseOwedWork(
      {
        projectId: id,
        workspaceId: workspace.workspaceId,
        actorUserId: user.userId,
      },
      c.req.valid("json"),
    );
    await deliverCalendarInvalidationsNow(workspace.workspaceId);
    return ok(c, projectCloseStatusSchema.parse(status));
  });
}
