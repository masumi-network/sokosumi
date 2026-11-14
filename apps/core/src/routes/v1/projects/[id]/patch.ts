import { createRoute, z } from "@hono/zod-openapi";
import { notFound } from "@/helpers/error";
import { jsonErrorResponse, jsonSuccessResponse } from "@/helpers/openapi";
import { ok } from "@/helpers/response";
import prisma from "@/lib/db/prisma";
import {
  type OpenAPIHonoWithAuth,
  withOrganizationSlugHeaderParameter,
} from "@/lib/hono";
import { requireOwnerUserContext } from "@/middleware/auth";
import { requireWorkspaceContext } from "@/middleware/workspace";
import {
  mapProjectForApi,
  patchProjectRequestSchema,
  projectApiInclude,
  projectSchema,
} from "@/schemas/project.schema";
import { setProjectHealth, updateProject } from "@/services/projects.service";

const paramsSchema = z.object({
  id: z
    .string()
    .uuid()
    .openapi({
      param: { name: "id", in: "path" },
      example: "aaaaaaaa-aaaa-4aaa-aaaa-aaaaaaaaaaaa",
    }),
});

const route = withOrganizationSlugHeaderParameter(
  createRoute({
    method: "patch",
    path: "/{id}",
    description:
      "Update a project's name, identifier, briefing, website, logo, default Studio logo placement, social posting instructions, or health (On track / At risk / Off track with a note; Core stamps who set it and when). Null or blank postingInstructionsMd clears them. The deprecated description field is accepted as a briefing alias; DESIGN.md uses its dedicated PUT/DELETE routes. Changing websiteUrl does not clear logo or DESIGN.md. Interactive session user only; coworker keys are rejected.",
    tags: ["Projects"],
    request: {
      params: paramsSchema,
      body: {
        content: {
          "application/json": {
            schema: patchProjectRequestSchema,
          },
        },
      },
    },
    responses: {
      200: jsonSuccessResponse(projectSchema, "Updated project"),
      401: jsonErrorResponse("Unauthorized"),
      403: jsonErrorResponse("Forbidden"),
      404: jsonErrorResponse("Not Found"),
      409: jsonErrorResponse(
        "Project identifier already in use, or health set on a closing or closed Project",
      ),
      422: jsonErrorResponse("Unprocessable Entity"),
    },
  }),
);

export default function mount(app: OpenAPIHonoWithAuth) {
  app.openapi(route, async (c) => {
    const { userId } = requireOwnerUserContext(c.var.authContext);
    const workspaceContext = requireWorkspaceContext(c.var.workspaceContext);
    const { id } = c.req.valid("param");
    const { health, ...body } = c.req.valid("json");
    const { workspaceId } = workspaceContext;
    if (health !== undefined) {
      await setProjectHealth(
        workspaceId,
        id,
        health && { ...health, setByUserId: userId },
      );
    }
    if (Object.values(body).some((value) => value !== undefined)) {
      await updateProject(workspaceId, id, body);
    }
    const project = await prisma.project.findFirst({
      where: { id, workspaceId },
      include: projectApiInclude,
    });
    if (!project) throw notFound("Project not found");
    return ok(
      c,
      mapProjectForApi(project, {
        // cmoProjectLock refused this write on a CMO Project.
        cmo: false,
      }),
    );
  });
}
