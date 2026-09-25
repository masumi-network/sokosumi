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
  createImageJobRequestSchema,
  imageStudioJobSchema,
  imageStudioProjectParamsSchema,
} from "@/schemas/project-image-studio.schema";
import {
  createImageJob,
  DEFAULT_SETTINGS,
} from "@/services/image-studio-jobs.service";

const route = withOrganizationSlugHeaderParameter(
  createRoute({
    method: "post",
    path: "/{id}/image-studio/jobs",
    description:
      "Start an image generation. Submitting the same idempotencyKey again returns the existing job rather than buying a second image.",
    tags: ["Projects"],
    request: {
      params: imageStudioProjectParamsSchema,
      body: {
        required: true,
        content: {
          "application/json": { schema: createImageJobRequestSchema },
        },
      },
    },
    responses: {
      201: jsonSuccessResponse(
        imageStudioJobSchema,
        "Image generation started",
      ),
      400: jsonErrorResponse("Bad Request"),
      401: jsonErrorResponse("Unauthorized"),
      403: jsonErrorResponse("Forbidden"),
      404: jsonErrorResponse("Not Found"),
      422: jsonErrorResponse("Unprocessable Entity"),
      429: jsonErrorResponse("Too Many Requests"),
    },
  }),
);

export default function mount(app: Pick<OpenAPIHonoWithAuth, "openapi">): void {
  app.openapi(route, async (c) => {
    const userContext = requireInteractiveUserAuthContext(c.var.authContext);
    const workspaceContext = requireWorkspaceContext(c.var.workspaceContext);
    const { id: projectId } = c.req.valid("param");
    const input = c.req.valid("json");

    const job = await createImageJob({
      projectId,
      workspaceId: workspaceContext.workspaceId,
      userId: userContext.userId,
      sessionId: input.sessionId,
      prompt: input.prompt,
      settings: { ...DEFAULT_SETTINGS, ...input.settings },
      referenceAssetIds: input.referenceAssetIds,
      parentAssetId: input.parentAssetId,
      idempotencyKey: input.idempotencyKey,
    });

    return created(
      c,
      imageStudioJobSchema.parse({
        id: job.id,
        status: job.status,
        kind: job.kind,
        prompt: job.prompt,
        error: job.error,
        parentAssetId: job.parentAssetId,
        assetId: null,
        createdAt: job.createdAt,
        submittedAt: job.submittedAt,
        settledAt: job.settledAt,
        retryMayDuplicateCharge: job.status === "SUBMISSION_UNCERTAIN",
      }),
    );
  });
}
