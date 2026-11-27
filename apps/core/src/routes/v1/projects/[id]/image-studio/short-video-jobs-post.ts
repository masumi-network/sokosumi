import { createRoute } from "@hono/zod-openapi";

import { jsonErrorResponse, jsonSuccessResponse } from "@/helpers/openapi";
import { created } from "@/helpers/response";
import { resolveFileActor } from "@/lib/files/actor";
import {
  type OpenAPIHonoWithAuth,
  withOrganizationSlugHeaderParameter,
} from "@/lib/hono";
import { imageStudioValidationHook } from "@/lib/image-studio/request-validation";
import { requireUserAuthContext } from "@/middleware/auth";
import { requireWorkspaceContext } from "@/middleware/workspace";
import {
  createShortVideoJobRequestSchema,
  imageStudioJobSchema,
  imageStudioProjectParamsSchema,
} from "@/schemas/project-image-studio.schema";
import { toJobView } from "@/services/image-studio-assets.service";
import { createShortVideoJob } from "@/services/image-studio-jobs.service";

const route = withOrganizationSlugHeaderParameter(
  createRoute({
    method: "post",
    path: "/{id}/image-studio/short-video-jobs",
    description:
      "Start a short: a 9:16 video without a presenter, cut from the Project's pictures and website to a voice (or to music, for a slideshow), with captions, a hook line, music and an end card. The price is quoted from the script and charged when the video is delivered. Submitting the same idempotencyKey again returns the existing job.",
    tags: ["Projects"],
    request: {
      params: imageStudioProjectParamsSchema,
      body: {
        required: true,
        content: {
          "application/json": { schema: createShortVideoJobRequestSchema },
        },
      },
    },
    responses: {
      201: jsonSuccessResponse(imageStudioJobSchema, "Short started"),
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
      const userContext = requireUserAuthContext(c.var.authContext);
      const workspaceContext = requireWorkspaceContext(c.var.workspaceContext);
      const { id: projectId } = c.req.valid("param");
      const input = c.req.valid("json");

      const job = await createShortVideoJob({
        projectId,
        workspaceId: workspaceContext.workspaceId,
        userId: userContext.userId,
        format: input.format,
        script: input.script,
        hookLine: input.hookLine ?? null,
        ...(input.launchDate ? { launchDate: input.launchDate } : {}),
        voice: input.voice,
        languageCode: input.languageCode,
        pictures: {
          assetIds: input.pictureAssetIds,
          fileIds: input.pictureFileIds,
          actor: resolveFileActor(
            { source: "session", ...userContext },
            { organizationId: workspaceContext.organizationId },
          ),
        },
        ...(input.shapes ? { shapes: input.shapes } : {}),
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
