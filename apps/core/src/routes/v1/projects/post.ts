import { createRoute } from "@hono/zod-openapi";

import { jsonErrorResponse, jsonSuccessResponse } from "@/helpers/openapi";
import { created } from "@/helpers/response";
import prisma from "@/lib/db/prisma";
import {
  type OpenAPIHonoWithAuth,
  withGlobalHeaderParameters,
} from "@/lib/hono";
import { requireUserContext } from "@/middleware/auth";
import { requireWorkspaceContext } from "@/middleware/workspace";
import {
  createProjectRequestSchema,
  projectSchema,
} from "@/schemas/project.schema";

const route = withGlobalHeaderParameters(
  createRoute({
    method: "post",
    path: "/",
    description: "Create a project in the active workspace",
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
    requireUserContext(c.var.authContext);
    const workspaceContext = requireWorkspaceContext(c.var.workspaceContext);
    const body = c.req.valid("json");

    const row = await prisma.project.create({
      data: {
        workspaceId: workspaceContext.workspaceId,
        name: body.name,
        description: body.description ?? null,
      },
    });

    return created(c, projectSchema.parse(row));
  });
}
