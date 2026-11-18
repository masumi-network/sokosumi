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
  createTalkingVideoJobRequestSchema,
  imageStudioJobSchema,
  imageStudioProjectParamsSchema,
} from "@/schemas/project-image-studio.schema";
import { toJobView } from "@/services/image-studio-assets.service";
import { createTalkingVideoJob } from "@/services/image-studio-jobs.service";

const route = withOrganizationSlugHeaderParameter(
  createRoute({
    method: "post",
    path: "/{id}/image-studio/talking-video-jobs",
    description:
      "Start a talking video: a presenter speaks the script, with captions, in 9:16. The price is quoted from the script and charged when the video is delivered. Submitting the same idempotencyKey again returns the existing job rather than buying a second video.",
    tags: ["Projects"],
    request: {
      params: imageStudioProjectParamsSchema,
      body: {
        required: true,
        content: {
          "application/json": { schema: createTalkingVideoJobRequestSchema },
        },
      },
    },
    responses: {
      201: jsonSuccessResponse(imageStudioJobSchema, "Talking video started"),
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

      const job = await createTalkingVideoJob({
        projectId,
        workspaceId: workspaceContext.workspaceId,
        userId: userContext.userId,
        modelId: input.modelId,
        script: input.script,
        voice: input.voice,
        languageCode: input.languageCode,
        presenter:
          input.presenter.kind === "stock"
            ? input.presenter
            : {
                kind: "file",
                fileId: input.presenter.fileId,
                actor: {
                  userId: userContext.userId,
                  organizationId: workspaceContext.organizationId,
                  kind: "interactive",
                },
                consentAt: new Date(),
              },
        siteShots: input.siteShots,
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
