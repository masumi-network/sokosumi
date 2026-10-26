import { createRoute } from "@hono/zod-openapi";

import { jsonErrorResponse, jsonSuccessResponse } from "@/helpers/openapi";
import { created } from "@/helpers/response";
import {
  type OpenAPIHonoWithAuth,
  withOrganizationSlugHeaderParameter,
} from "@/lib/hono";
import { imageStudioValidationHook } from "@/lib/image-studio/request-validation";
import { requireInteractiveUserAuthContext } from "@/middleware/auth";
import { requireWorkspaceContext } from "@/middleware/workspace";
import {
  createVideoJobRequestSchema,
  imageStudioJobSchema,
  imageStudioProjectParamsSchema,
} from "@/schemas/project-image-studio.schema";
import { toJobView } from "@/services/image-studio-assets.service";
import { createVideoJob } from "@/services/image-studio-jobs.service";

const route = withOrganizationSlugHeaderParameter(
  createRoute({
    method: "post",
    path: "/{id}/image-studio/video-jobs",
    description:
      "Start a video generation, from a prompt or by animating a gallery image. Submitting the same idempotencyKey again returns the existing job rather than buying a second video.",
    tags: ["Projects"],
    request: {
      params: imageStudioProjectParamsSchema,
      body: {
        required: true,
        content: {
          "application/json": { schema: createVideoJobRequestSchema },
        },
      },
    },
    responses: {
      201: jsonSuccessResponse(
        imageStudioJobSchema,
        "Video generation started",
      ),
      400: jsonErrorResponse("Bad Request"),
      401: jsonErrorResponse("Unauthorized"),
      403: jsonErrorResponse("Forbidden"),
      404: jsonErrorResponse("Not Found"),
      409: jsonErrorResponse("Conflict"),
      422: jsonErrorResponse("Unprocessable Entity"),
      429: jsonErrorResponse("Too Many Requests"),
      503: jsonErrorResponse("Service Unavailable - storage unavailable"),
    },
  }),
);

export default function mount(app: Pick<OpenAPIHonoWithAuth, "openapi">): void {
  app.openapi(
    route,
    async (c) => {
      const userContext = requireInteractiveUserAuthContext(c.var.authContext);
      const workspaceContext = requireWorkspaceContext(c.var.workspaceContext);
      const { id: projectId } = c.req.valid("param");
      const input = c.req.valid("json");

      const job = await createVideoJob({
        projectId,
        workspaceId: workspaceContext.workspaceId,
        userId: userContext.userId,
        sessionId: input.sessionId,
        prompt: input.prompt,
        modelId: input.modelId,
        settings: input.settings,
        sourceAssetId: input.sourceAssetId,
        idempotencyKey: input.idempotencyKey,
      });

      return created(
        c,
        imageStudioJobSchema.parse(toJobView({ ...job, asset: null })),
      );
    },
    imageStudioValidationHook,
  );
}
