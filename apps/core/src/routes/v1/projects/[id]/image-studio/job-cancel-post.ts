import { createRoute, z } from "@hono/zod-openapi";

import { jsonErrorResponse, jsonSuccessResponse } from "@/helpers/openapi";
import { ok } from "@/helpers/response";
import {
  type OpenAPIHonoWithAuth,
  withOrganizationSlugHeaderParameter,
} from "@/lib/hono";
import { requireInteractiveUserAuthContext } from "@/middleware/auth";
import { requireWorkspaceContext } from "@/middleware/workspace";
import { imageStudioJobParamsSchema } from "@/schemas/project-image-studio.schema";
import { requestCancel } from "@/services/image-studio-jobs.service";

const responseSchema = z
  .object({
    /**
     * Whether the provider accepted the request. It is not a promise that the
     * work stopped: for a request already running, fal only signals the
     * runner. Nothing here says anything about billing.
     */
    accepted: z.boolean(),
  })
  .openapi("CancelProjectImageJobResponse");

const route = withOrganizationSlugHeaderParameter(
  createRoute({
    method: "post",
    path: "/{id}/image-studio/jobs/{jobId}/cancel",
    description:
      "Ask the provider to cancel a queued or running generation. Acceptance is not a guarantee that the work stopped, and implies nothing about billing.",
    tags: ["Projects"],
    request: { params: imageStudioJobParamsSchema },
    responses: {
      200: jsonSuccessResponse(responseSchema, "Cancellation requested"),
      401: jsonErrorResponse("Unauthorized"),
      403: jsonErrorResponse("Forbidden"),
      404: jsonErrorResponse("Not Found"),
      422: jsonErrorResponse("Unprocessable Entity"),
    },
  }),
);

export default function mount(app: Pick<OpenAPIHonoWithAuth, "openapi">): void {
  app.openapi(route, async (c) => {
    const userContext = requireInteractiveUserAuthContext(c.var.authContext);
    const workspaceContext = requireWorkspaceContext(c.var.workspaceContext);
    const { id: projectId, jobId } = c.req.valid("param");

    const result = await requestCancel({
      jobId,
      projectId,
      workspaceId: workspaceContext.workspaceId,
      userId: userContext.userId,
    });
    return ok(c, responseSchema.parse(result));
  });
}
