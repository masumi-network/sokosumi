import { createRoute, z } from "@hono/zod-openapi";

import { jsonErrorResponse, jsonSuccessResponse } from "@/helpers/openapi";
import { ok } from "@/helpers/response";
import prisma from "@/lib/db/prisma";
import {
  type OpenAPIHonoWithAuth,
  withGlobalHeaderParameters,
} from "@/lib/hono";
import { requireUserContext } from "@/middleware/auth";
import { requireWorkspaceContext } from "@/middleware/workspace";
import { projectSchema } from "@/schemas/project.schema";

const route = withGlobalHeaderParameters(
  createRoute({
    method: "get",
    path: "/",
    description: "List projects in the active workspace",
    tags: ["Projects"],
    responses: {
      200: jsonSuccessResponse(
        z.array(projectSchema),
        "Projects in the workspace",
      ),
      401: jsonErrorResponse("Unauthorized"),
      403: jsonErrorResponse("Forbidden"),
    },
  }),
);

export default function mount(app: OpenAPIHonoWithAuth) {
  app.openapi(route, async (c) => {
    requireUserContext(c.var.authContext);
    const workspaceContext = requireWorkspaceContext(c.var.workspaceContext);

    const projects = await prisma.project.findMany({
      where: { workspaceId: workspaceContext.workspaceId },
      orderBy: [{ updatedAt: "desc" }, { id: "desc" }],
    });

    return ok(c, z.array(projectSchema).parse(projects));
  });
}
