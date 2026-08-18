import { createRoute } from "@hono/zod-openapi";

import { jsonErrorResponse, jsonSuccessResponse } from "@/helpers/openapi";
import { created } from "@/helpers/response";
import prisma from "@/lib/db/prisma";
import {
  type OpenAPIHonoWithAuth,
  withOrchestratorContextHeaderParameters,
} from "@/lib/hono";
import {
  generateProjectFilesToken,
  uploadProjectBriefingFile,
} from "@/lib/project-files-blob";
import { requireOwnerUserContext } from "@/middleware/auth";
import { requireWorkspaceContext } from "@/middleware/workspace";
import {
  createProjectRequestSchema,
  mapProjectForApi,
  projectSchema,
} from "@/schemas/project.schema";

const route = withOrchestratorContextHeaderParameters(
  createRoute({
    method: "post",
    path: "/",
    description:
      "Create a project with an optional website and briefing in the active workspace. The deprecated description field is accepted as a briefing alias. Session user or orchestrator with context headers; coworker keys are rejected.",
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
    const briefing = body.briefing?.trim() || null;
    const filesToken = briefing ? generateProjectFilesToken() : null;

    let project = await prisma.project.create({
      data: {
        workspaceId: workspaceContext.workspaceId,
        name: body.name,
        filesToken,
        briefing,
        websiteUrl: body.websiteUrl ?? null,
      },
    });

    if (briefing && filesToken) {
      const briefingUrl = await uploadProjectBriefingFile(
        project.id,
        filesToken,
        briefing,
      );
      if (briefingUrl) {
        project = await prisma.project.update({
          where: { id: project.id },
          data: { briefingUrl },
        });
      }
    }

    return created(c, mapProjectForApi(project));
  });
}
