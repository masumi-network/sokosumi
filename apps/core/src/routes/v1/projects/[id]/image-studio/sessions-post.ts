import { createRoute } from "@hono/zod-openapi";

import { jsonErrorResponse, jsonSuccessResponse } from "@/helpers/openapi";
import { created } from "@/helpers/response";
import {
  type OpenAPIHonoWithAuth,
  withOrganizationSlugHeaderParameter,
} from "@/lib/hono";
import { requireInteractiveUserAuthContext } from "@/middleware/auth";
import { requireWorkspaceContext } from "@/middleware/workspace";
import {
  bindImageSessionRequestSchema,
  imageStudioProjectParamsSchema,
  imageStudioSessionSchema,
} from "@/schemas/project-image-studio.schema";
import { bindSession } from "@/services/image-studio-sessions.service";

const route = withOrganizationSlugHeaderParameter(
  createRoute({
    method: "post",
    path: "/{id}/image-studio/sessions",
    description:
      "Bind an eve conversation to this Project. The binding is what makes the transcript project-scoped and resumable; an eve session id alone never reaches a conversation.",
    tags: ["Projects"],
    request: {
      params: imageStudioProjectParamsSchema,
      body: {
        required: true,
        content: {
          "application/json": { schema: bindImageSessionRequestSchema },
        },
      },
    },
    responses: {
      201: jsonSuccessResponse(imageStudioSessionSchema, "Bound conversation"),
      401: jsonErrorResponse("Unauthorized"),
      403: jsonErrorResponse("Forbidden"),
      404: jsonErrorResponse("Not Found"),
    },
  }),
);

export default function mount(app: Pick<OpenAPIHonoWithAuth, "openapi">): void {
  app.openapi(route, async (c) => {
    const userContext = requireInteractiveUserAuthContext(c.var.authContext);
    const workspaceContext = requireWorkspaceContext(c.var.workspaceContext);
    const { id: projectId } = c.req.valid("param");
    const input = c.req.valid("json");

    const session = await bindSession({
      projectId,
      workspaceId: workspaceContext.workspaceId,
      userId: userContext.userId,
      eveSessionId: input.eveSessionId,
      title: input.title,
    });
    return created(c, imageStudioSessionSchema.parse(session));
  });
}
