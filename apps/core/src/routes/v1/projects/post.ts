import { createRoute } from "@hono/zod-openapi";
import { jsonErrorResponse, jsonSuccessResponse } from "@/helpers/openapi";
import { created } from "@/helpers/response";
import {
  type OpenAPIHonoWithAuth,
  withOrganizationSlugHeaderParameter,
} from "@/lib/hono";
import { requireOwnerUserContext } from "@/middleware/auth";
import { requireWorkspaceContext } from "@/middleware/workspace";
import {
  createProjectRequestSchema,
  mapProjectForApi,
  projectSchema,
} from "@/schemas/project.schema";
import { createProject } from "@/services/projects.service";

const route = withOrganizationSlugHeaderParameter(
  createRoute({
    method: "post",
    path: "/",
    description:
      "Create a project with an optional identifier, website, and briefing in the active workspace. The deprecated description field is accepted as a briefing alias. Interactive session user only; coworker keys are rejected.",
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
      409: jsonErrorResponse("Project identifier already in use"),
    },
  }),
);

export default function mount(app: OpenAPIHonoWithAuth) {
  app.openapi(route, async (c) => {
    requireOwnerUserContext(c.var.authContext);
    const workspaceContext = requireWorkspaceContext(c.var.workspaceContext);
    const body = c.req.valid("json");
    const project = await createProject(workspaceContext.workspaceId, body);
    return created(c, mapProjectForApi(project));
  });
}
