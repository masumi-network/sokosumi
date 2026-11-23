import { createRoute, type OpenAPIHono, z } from "@hono/zod-openapi";

import { jsonErrorResponse, jsonSuccessResponse } from "@/helpers/openapi";
import { ok } from "@/helpers/response";
import type { AgentGrantContext } from "@/routes/image-studio-agent/authorize";
import { studioRouterArmSchema } from "@/schemas/image-studio-route.schema";
import {
  createImageJobRequestSchema,
  IMAGE_JOB_STATUSES,
  imageStudioSettingsSchema,
} from "@/schemas/project-image-studio.schema";
import { requireNotCmoProject } from "@/services/cmo-cuso.service";
import { createDrawnSvgJob } from "@/services/image-studio-jobs.service";

const route = createRoute({
  method: "post",
  path: "/draw-svg",
  tags: ["Image studio agent"],
  operationId: "drawStudioAgentSvg",
  request: {
    body: {
      required: true,
      content: {
        "application/json": {
          schema: createImageJobRequestSchema
            .pick({ prompt: true, idempotencyKey: true })
            .extend({
              svg: z.string().max(128 * 1024),
              aspectRatio: imageStudioSettingsSchema.shape.aspectRatio,
              placementId: z.string().trim().min(1).max(100).nullish(),
              experimentArm: studioRouterArmSchema.optional(),
            })
            .openapi("DrawStudioAgentSvgRequest"),
        },
      },
    },
  },
  responses: {
    200: jsonSuccessResponse(
      z.object({
        id: z.string(),
        status: z.enum(IMAGE_JOB_STATUSES),
        model: z.string(),
        settings: z.unknown(),
      }),
      "Drawing job",
    ),
    400: jsonErrorResponse("Invalid SVG or request"),
    401: jsonErrorResponse("Unauthorized"),
    404: jsonErrorResponse("Project not found"),
    409: jsonErrorResponse("Project is read only or busy"),
    422: jsonErrorResponse("Invalid request or insufficient balance"),
    429: jsonErrorResponse("Studio limit reached"),
    503: jsonErrorResponse("Service unavailable"),
  },
});

export default function mount(
  app: OpenAPIHono<{ Variables: { agentGrant: AgentGrantContext } }>,
) {
  app.openapi(route, async (c) => {
    const grant = c.var.agentGrant;
    await requireNotCmoProject(grant.projectId, grant.workspaceId);
    const { id, status, model, settings } = await createDrawnSvgJob({
      ...grant,
      ...c.req.valid("json"),
    });
    return ok(c, { id, status, model, settings });
  });
}
