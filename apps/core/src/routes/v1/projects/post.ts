import { createRoute } from "@hono/zod-openapi";

import { jsonErrorResponse, jsonSuccessResponse } from "@/helpers/openapi";
import { created } from "@/helpers/response";
import prisma from "@/lib/db/prisma";
import {
  type OpenAPIHonoWithAuth,
  withOrchestratorContextHeaderParameters,
} from "@/lib/hono";
import { requireOwnerUserContext } from "@/middleware/auth";
import { requireWorkspaceContext } from "@/middleware/workspace";
import {
  createProjectRequestSchema,
  projectSchema,
} from "@/schemas/project.schema";

const route = withOrchestratorContextHeaderParameters(
  createRoute({
    method: "post",
    path: "/",
    description:
      "Create a project in the active workspace. Session user or orchestrator with context headers; coworker keys are rejected so X-Context-User-Id cannot mint projects in another user's workspace.",
    tags: ["Projects"],
    request: {
      body: {
        content: {
          "application/json": {
            schema: createProjectRequestSchema,
          },
        },
      },
    },
    responses: {
      201: jsonSuccessResponse(projectSchema, "Project created"),
      401: jsonErrorResponse("Unauthorized"),
      403: jsonErrorResponse("Forbidden"),
    },
  }),
);

export default function mount(app: OpenAPIHonoWithAuth) {
  app.openapi(route, async (c) => {
    requireOwnerUserContext(c.var.authContext);
    const workspaceContext = requireWorkspaceContext(c.var.workspaceContext);
    const body = c.req.valid("json");

    const project = await prisma.project.create({
      data: {
        workspaceId: workspaceContext.workspaceId,
        name: body.name,
        description: body.description ?? null,
      },
    });

    return created(c, projectSchema.parse(project));
  });
}
