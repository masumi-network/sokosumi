import { createRoute } from "@hono/zod-openapi";

import { jsonErrorResponse, jsonSuccessResponse } from "@/helpers/openapi";
import { ok } from "@/helpers/response";
import {
  type OpenAPIHonoWithAuth,
  withOrganizationSlugHeaderParameter,
} from "@/lib/hono";
import { requireInteractiveUserAuthContext } from "@/middleware/auth";
import { requireWorkspaceContext } from "@/middleware/workspace";
import { imageStudioRecentProjectsSchema } from "@/schemas/project-image-studio.schema";
import { listRecentStudioProjects } from "@/services/image-studio-assets.service";

const RECENT_PROJECTS = 3;

const route = withOrganizationSlugHeaderParameter(
  createRoute({
    method: "get",
    path: "/recent-projects",
    description:
      "The three Projects in the workspace whose Studio images are newest, each with its image count and newest image. Closed and Hidden Projects are left out. Empty for a workspace with no Studio images.",
    tags: ["Image Studio"],
    responses: {
      200: jsonSuccessResponse(
        imageStudioRecentProjectsSchema,
        "Recent Studio projects",
      ),
      401: jsonErrorResponse("Unauthorized"),
      403: jsonErrorResponse("Forbidden"),
      404: jsonErrorResponse("Not Found"),
    },
  }),
);

export default function mount(app: Pick<OpenAPIHonoWithAuth, "openapi">): void {
  app.openapi(route, async (c) => {
    const userContext = requireInteractiveUserAuthContext(c.var.authContext);
    const workspaceContext = requireWorkspaceContext(c.var.workspaceContext);
    const projects = await listRecentStudioProjects({
      workspaceId: workspaceContext.workspaceId,
      userId: userContext.userId,
      limit: RECENT_PROJECTS,
    });
    return ok(c, imageStudioRecentProjectsSchema.parse({ projects }));
  });
}
