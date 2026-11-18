import { createRoute } from "@hono/zod-openapi";

import { serviceUnavailable } from "@/helpers/error";
import { jsonErrorResponse, jsonSuccessResponse } from "@/helpers/openapi";
import { ok } from "@/helpers/response";
import {
  type OpenAPIHonoWithAuth,
  withOrganizationSlugHeaderParameter,
} from "@/lib/hono";
import { requireProjectAccess } from "@/lib/image-studio/access";
import { requireInteractiveUserAuthContext } from "@/middleware/auth";
import { requireWorkspaceContext } from "@/middleware/workspace";
import {
  imageStudioProjectParamsSchema,
  talkingVideoScriptsSchema,
  writeTalkingVideoScriptsRequestSchema,
} from "@/schemas/project-image-studio.schema";
import { writeTalkingVideoScripts } from "@/services/talking-video-scripts.service";

const route = withOrganizationSlugHeaderParameter(
  createRoute({
    method: "post",
    path: "/{id}/image-studio/talking-video-scripts",
    description:
      "Hook-led scripts for talking videos, written from the Project's brand. Nothing is stored or charged; the caller picks one and starts a talking video with it.",
    tags: ["Projects"],
    request: {
      params: imageStudioProjectParamsSchema,
      body: {
        required: true,
        content: {
          "application/json": { schema: writeTalkingVideoScriptsRequestSchema },
        },
      },
    },
    responses: {
      200: jsonSuccessResponse(talkingVideoScriptsSchema, "Scripts written"),
      401: jsonErrorResponse("Unauthorized"),
      403: jsonErrorResponse("Forbidden"),
      404: jsonErrorResponse("Not Found"),
      409: jsonErrorResponse("CMO project is read-only"),
      422: jsonErrorResponse("Unprocessable Entity"),
      503: jsonErrorResponse("Service Unavailable"),
    },
  }),
);

export default function mount(app: Pick<OpenAPIHonoWithAuth, "openapi">): void {
  app.openapi(route, async (c) => {
    const userContext = requireInteractiveUserAuthContext(c.var.authContext);
    const workspaceContext = requireWorkspaceContext(c.var.workspaceContext);
    const { id: projectId } = c.req.valid("param");
    const input = c.req.valid("json");
    await requireProjectAccess({
      projectId,
      workspaceId: workspaceContext.workspaceId,
      userId: userContext.userId,
    });

    const scripts = await writeTalkingVideoScripts({
      projectId,
      topic: input.topic,
      languageCode: input.languageCode,
    }).catch(() => {
      throw serviceUnavailable("Could not write scripts");
    });
    if (scripts.length === 0)
      throw serviceUnavailable("Could not write scripts");
    return ok(c, talkingVideoScriptsSchema.parse({ scripts }));
  });
}
