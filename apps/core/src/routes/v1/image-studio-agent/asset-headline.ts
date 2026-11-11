import { createRoute, type OpenAPIHono, z } from "@hono/zod-openapi";

import { jsonErrorResponse, jsonSuccessResponse } from "@/helpers/openapi";
import { ok } from "@/helpers/response";
import type { AgentGrantContext } from "@/routes/image-studio-agent/authorize";
import {
  saveStudioAdHeadlineSchema,
  studioAdHeadlineSchema,
  studioHeadlineTextSchema,
} from "@/schemas/project-image-studio.schema";
import { requireNotCmoProject } from "@/services/cmo-cuso.service";
import {
  readStudioAdHeadline,
  saveStudioAdHeadline,
} from "@/services/studio-ad-headline.service";

const route = {
  path: "/assets/{assetId}/headline" as const,
  tags: ["Image studio agent"],
};

const params = z.object({ assetId: z.uuid() });
const errors = {
  400: jsonErrorResponse("Invalid request"),
  401: jsonErrorResponse("Unauthorized"),
  404: jsonErrorResponse("Image not found"),
  503: jsonErrorResponse("Service Unavailable"),
};

const readRoute = createRoute({
  ...route,
  method: "get",
  operationId: "readStudioAgentAdHeadline",
  request: { params },
  responses: {
    ...errors,
    200: jsonSuccessResponse(
      z
        .object({
          headline: studioAdHeadlineSchema,
          approvedLines: z.array(studioHeadlineTextSchema),
        })
        .openapi("StudioAgentAdHeadline"),
      "Current export headline and approved lines in the authorized project",
    ),
  },
});

const updateRoute = createRoute({
  ...route,
  method: "put",
  operationId: "saveStudioAgentAdHeadline",
  request: {
    params,
    body: {
      required: true,
      content: {
        "application/json": {
          schema: saveStudioAdHeadlineSchema
            .extend({ expectedRevision: z.number().int().nonnegative() })
            .openapi("SaveStudioAgentAdHeadline"),
        },
      },
    },
  },
  responses: {
    ...errors,
    200: jsonSuccessResponse(studioAdHeadlineSchema, "Saved export headline"),
    409: jsonErrorResponse("Headline save conflict"),
    422: jsonErrorResponse("Headline is unavailable in Brand Kit"),
  },
});

export default function mount(
  app: OpenAPIHono<{ Variables: { agentGrant: AgentGrantContext } }>,
): void {
  app.openapi(readRoute, async (c) =>
    ok(
      c,
      await readStudioAdHeadline({
        ...c.var.agentGrant,
        ...c.req.valid("param"),
      }),
    ),
  );
  app.openapi(updateRoute, async (c) => {
    const { projectId, workspaceId } = c.var.agentGrant;
    await requireNotCmoProject(projectId, workspaceId);
    return ok(
      c,
      await saveStudioAdHeadline({
        ...c.var.agentGrant,
        ...c.req.valid("param"),
        ...c.req.valid("json"),
      }),
    );
  });
}
